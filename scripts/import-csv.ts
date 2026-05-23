import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initDb, db } from '../core/db.js';
import { categorize } from '../core/categorize.js';
import { deduplicateCsvVsPlaid } from '../core/dedup.js';

initDb();

// ── helpers ──────────────────────────────────────────────────────────────────

function parseDate(raw: string): string {
  // MM/DD/YY → YYYY-MM-DD
  if (raw.includes('/')) {
    const [m, d, y] = raw.split('/');
    const fullYear = parseInt(y) < 50 ? `20${y}` : `19${y}`;
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw; // already YYYY-MM-DD
}

function txId(accountMask: string, date: string, description: string, amount: number): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${accountMask}|${date}|${description.trim().toLowerCase()}|${amount}`)
    .digest('hex')
    .slice(0, 16);
  return `csv-${hash}`;
}

function ensureAccount(mask: string, name: string, type: string, subtype: string): string {
  const existing = db
    .prepare('SELECT id FROM accounts WHERE mask = ?')
    .get(mask) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = `csv-acct-${mask}`;
  db.prepare(`
    INSERT OR IGNORE INTO accounts (id, name, type, subtype, institution_name, mask)
    VALUES (?, ?, ?, ?, 'Capital One', ?)
  `).run(id, name, type, subtype, mask);
  return id;
}

// Capital One CSV category → our category
const CAP_ONE_CATEGORY_MAP: Record<string, string> = {
  'Gas/Automotive':       'Transportation',
  'Automotive':           'Transportation',
  'Phone/Cable':          'Bills & Utilities',
  'Utilities':            'Bills & Utilities',
  'Cable/Satellite Svcs': 'Bills & Utilities',
  'Merchandise':          'Shopping',
  'Clothing':             'Shopping',
  'Electronics':          'Shopping',
  'Groceries':            'Food & Drink',
  'Restaurants':          'Food & Drink',
  'Food & Drink':         'Food & Drink',
  'Travel':               'Travel',
  'Airlines':             'Travel',
  'Hotel':                'Travel',
  'Entertainment':        'Entertainment',
  'Movies/Music':         'Entertainment',
  'Healthcare/Medical':   'Medical',
  'Pharmacy':             'Medical',
  'Personal Care':        'Personal Care',
  'Home Improvement':     'Home',
  'Furnishings':          'Home',
  'Payment/Credit':       'Transfer',
  'Transfer':             'Transfer',
  'Fees/Interest':        'Fees',
  'Other Services':       'Services',
  'Other Travel':         'Travel',
  'Streaming':            'Entertainment',
  'Subscription':         'Services',
};

function mapCapOneCategory(raw: string): string | null {
  return CAP_ONE_CATEGORY_MAP[raw.trim()] ?? null;
}

const insertTx = db.prepare(`
  INSERT OR IGNORE INTO transactions (id, account_id, date, name, amount, category, raw_category, pending)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0)
`);

const updateCategory = db.prepare(`
  UPDATE transactions SET category = ?, raw_category = ? WHERE id = ?
`);

// ── parsers ───────────────────────────────────────────────────────────────────

function parseCheckingOrSavings(filePath: string): number {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
  let count = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const [acctNum, description, rawDate, txType, rawAmount] = line.split(',');
    const mask = acctNum.trim();
    const date = parseDate(rawDate.trim());
    const name = description.trim();
    // Plaid convention: positive = money out, negative = money in
    const absAmount = parseFloat(rawAmount.trim());
    const amount = txType.trim().toLowerCase() === 'credit' ? -absAmount : absAmount;

    const accountId = ensureAccount(mask, guessAccountName(filePath, mask), 'depository', guessSubtype(filePath));
    const category = categorize(name, null, null);
    const id = txId(mask, date, name, amount);

    insertTx.run(id, accountId, date, name, amount, category);
    count++;
  }

  return count;
}

function parseCreditCard(filePath: string): number {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
  let count = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    // Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit
    const parts = line.split(',');
    const date = parseDate(parts[0].trim());
    const mask = parts[2].trim();
    const name = parts[3].trim();
    const debit = parseFloat(parts[4].trim() || '0') || 0;   // wait — actually col 5 is Debit
    // Re-parse carefully (description might contain commas... unlikely but possible)
    // Format is fixed 7 columns: Date,PostedDate,CardNo,Description,Category,Debit,Credit
    const cols = line.match(/^([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]*),([^,]*)$/);
    if (!cols) continue;

    const txDate = parseDate(cols[1].trim());
    const cardMask = cols[3].trim();
    const txName = cols[4].trim();
    const rawCapOneCategory = cols[5].trim();
    const txDebit = parseFloat(cols[6].trim() || '0') || 0;
    const txCredit = parseFloat(cols[7].trim() || '0') || 0;
    // Plaid convention: positive = expense, negative = income/payment
    const amount = txDebit > 0 ? txDebit : -txCredit;

    const accountId = ensureAccount(cardMask, `Credit Card ${cardMask}`, 'credit', 'credit card');
    const mapped = mapCapOneCategory(rawCapOneCategory);
    const category = mapped ?? categorize(txName, null, null);
    const id = txId(cardMask, txDate, txName, amount);

    const changes = (insertTx.run(id, accountId, txDate, txName, amount, category, rawCapOneCategory) as any).changes;
    // if row already existed (Plaid dupe), update its category if it was uncategorized
    if (changes === 0 && mapped) updateCategory.run(category, rawCapOneCategory, id);
    count++;
  }

  return count;
}

function guessAccountName(filePath: string, mask: string): string {
  const base = path.basename(filePath);
  if (base.includes('JointChecking')) return 'Joint Checking';
  if (base.includes('JointSavings')) return 'Joint Savings';
  if (base.includes('SlushFund')) return 'Slush Fund';
  return `Account ${mask}`;
}

function guessSubtype(filePath: string): string {
  const base = path.basename(filePath);
  return base.toLowerCase().includes('saving') ? 'savings' : 'checking';
}

// ── main ──────────────────────────────────────────────────────────────────────

const dir = process.argv[2] ?? process.cwd();
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.csv'));

let total = 0;

for (const file of files) {
  const filePath = path.join(dir, file);
  const isCreditCard = file.includes('transaction_download');
  const count = isCreditCard ? parseCreditCard(filePath) : parseCheckingOrSavings(filePath);
  console.log(`  ${file}: ${count} rows`);
  total += count;
}

const removed = deduplicateCsvVsPlaid();

console.log(`\nImported up to ${total} rows`);
if (removed > 0) console.log(`Removed ${removed} CSV rows that duplicated Plaid data`);
console.log(`Total: ${(db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number }).c}`);
