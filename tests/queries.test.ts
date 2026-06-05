import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

import { db } from '../core/db.js';
import {
  getRangeSummary,
  getFlexSummary,
  getHiddenCategories,
  getRecentTransactions,
  getMerchantSummary,
  getOwnerRows,
  hasAccounts,
} from '../core/queries.js';

let txId = 0;
async function insertTx(opts: {
  date?: string;
  name?: string;
  merchantName?: string | null;
  displayName?: string | null;
  amount: number;
  category?: string;
  pending?: number;
  ignored?: number;
  accountId?: string;
}): Promise<string> {
  txId++;
  const id = `tx${txId}`;
  await db.execute({
    sql: `INSERT INTO transactions (id, account_id, date, name, merchant_name, display_name, amount, category, pending, ignored)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      opts.accountId ?? 'acct1',
      opts.date ?? '2025-01-15',
      opts.name ?? 'Test Transaction',
      opts.merchantName ?? null,
      opts.displayName ?? null,
      opts.amount,
      opts.category ?? 'Shopping',
      opts.pending ?? 0,
      opts.ignored ?? 0,
    ],
  });
  return id;
}

// Creates a tag (if needed) and attaches it to the given transactions.
async function tagTxs(name: string, txIds: string[]) {
  await db.execute({ sql: 'INSERT OR IGNORE INTO tags (name) VALUES (?)', args: [name] });
  const r = await db.execute({ sql: 'SELECT id FROM tags WHERE name = ?', args: [name] });
  const tagId = Number((r.rows[0] as unknown as { id: number }).id);
  for (const id of txIds) {
    await db.execute({ sql: 'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', args: [id, tagId] });
  }
}

beforeEach(async () => {
  txId = 0;
  await db.execute('DELETE FROM transactions');
  await db.execute('DELETE FROM transaction_tags');
  await db.execute('DELETE FROM tags');
  await db.execute('DELETE FROM hidden_categories');
  await db.execute('DELETE FROM categories');
  await db.execute('DELETE FROM accounts');
});

// ──────────────────────────────────────────────────────────────────────
describe('getHiddenCategories', () => {
  it('returns empty set when no hidden categories', async () => {
    expect((await getHiddenCategories()).size).toBe(0);
  });

  it('returns set of hidden category names', async () => {
    await db.execute({ sql: 'INSERT INTO hidden_categories VALUES (?)', args: ['Transfer'] });
    await db.execute({ sql: 'INSERT INTO hidden_categories VALUES (?)', args: ['Loan Payment'] });
    const hidden = await getHiddenCategories();
    expect(hidden.has('Transfer')).toBe(true);
    expect(hidden.has('Loan Payment')).toBe(true);
    expect(hidden.has('Shopping')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getRangeSummary', () => {
  it('returns zeros for empty database', async () => {
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.income).toBe(0);
    expect(s.expenses).toBe(0);
    expect(s.net).toBe(0);
    expect(s.byCategory).toHaveLength(0);
  });

  it('separates expenses (positive amounts) from income (negative amounts)', async () => {
    await insertTx({ amount: 100, category: 'Shopping' });
    await insertTx({ amount: -200, category: 'Income' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.expenses).toBeCloseTo(100);
    expect(s.income).toBeCloseTo(200);
    expect(s.net).toBeCloseTo(100);
  });

  it('only includes dates within the range', async () => {
    await insertTx({ date: '2025-01-01', amount: 50, category: 'Shopping' });
    await insertTx({ date: '2025-01-31', amount: 50, category: 'Shopping' });
    await insertTx({ date: '2024-12-31', amount: 999, category: 'Shopping' });
    await insertTx({ date: '2025-02-01', amount: 999, category: 'Shopping' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.expenses).toBeCloseTo(100);
  });

  it('excludes pending transactions', async () => {
    await insertTx({ amount: 100, category: 'Shopping', pending: 1 });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.expenses).toBe(0);
  });

  it('excludes ignored transactions', async () => {
    await insertTx({ amount: 100, category: 'Shopping', ignored: 1 });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.expenses).toBe(0);
  });

  it('excludes hidden categories', async () => {
    await db.execute({ sql: 'INSERT INTO hidden_categories VALUES (?)', args: ['Transfer'] });
    await insertTx({ amount: 500, category: 'Transfer' });
    await insertTx({ amount: 100, category: 'Shopping' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.expenses).toBeCloseTo(100);
  });

  it('nets refunds within a category before classifying as income/expense', async () => {
    await insertTx({ amount: 1000, category: 'Travel' });
    await insertTx({ amount: -800, category: 'Travel' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.expenses).toBeCloseTo(200);
    expect(s.income).toBe(0);
    expect(s.byCategory).toHaveLength(1);
    expect(s.byCategory[0]).toEqual({ category: 'Travel', total: 200 });
  });

  it('categories with net negative total count as income', async () => {
    await insertTx({ amount: 100, category: 'Rewards' });
    await insertTx({ amount: -200, category: 'Rewards' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.income).toBeCloseTo(100);
    expect(s.expenses).toBe(0);
    expect(s.byCategory).toHaveLength(0);
  });

  it('aggregates multiple categories correctly', async () => {
    await insertTx({ amount: 100, category: 'Food & Drink' });
    await insertTx({ amount: 200, category: 'Shopping' });
    await insertTx({ amount: -500, category: 'Income' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31');
    expect(s.expenses).toBeCloseTo(300);
    expect(s.income).toBeCloseTo(500);
    expect(s.byCategory).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getFlexSummary', () => {
  async function insertCat(name: string, flexibility: string | null) {
    await db.execute({ sql: 'INSERT INTO categories (name, flexibility) VALUES (?, ?)', args: [name, flexibility] });
  }

  beforeEach(async () => {
    await db.execute('DELETE FROM categories');
  });

  it('returns zeros for empty database', async () => {
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.fixed).toBe(0);
    expect(s.flexible).toBe(0);
    expect(s.discretionary).toBe(0);
    expect(s.untagged).toBe(0);
  });

  it('buckets spending by flexibility tier', async () => {
    await insertCat('Rent', 'fixed');
    await insertCat('Food & Drink', 'flexible');
    await insertCat('Entertainment', 'discretionary');
    await insertTx({ amount: 1500, category: 'Rent' });
    await insertTx({ amount: 300, category: 'Food & Drink' });
    await insertTx({ amount: 100, category: 'Entertainment' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.fixed).toBeCloseTo(1500);
    expect(s.flexible).toBeCloseTo(300);
    expect(s.discretionary).toBeCloseTo(100);
    expect(s.untagged).toBe(0);
  });

  it('puts spending with no flexibility tag in untagged', async () => {
    await insertCat('Mystery', null);
    await insertTx({ amount: 50, category: 'Mystery' });
    await insertTx({ amount: 75, category: 'UnknownCat' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.untagged).toBeCloseTo(125);
  });

  it('nets out refunds before bucketing — no tier inflation (regression)', async () => {
    await insertCat('Travel', 'discretionary');
    await insertTx({ amount: 10000, category: 'Travel' });
    await insertTx({ amount: -8000, category: 'Travel' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.discretionary).toBeCloseTo(2000);
    expect(s.fixed).toBe(0);
    expect(s.flexible).toBe(0);
  });

  it('excludes categories where net is negative (refund-heavy categories)', async () => {
    await insertCat('Travel', 'discretionary');
    await insertTx({ amount: 100, category: 'Travel' });
    await insertTx({ amount: -500, category: 'Travel' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.discretionary).toBe(0);
  });

  it('fixed + flexible + discretionary + untagged == total expenses', async () => {
    await insertCat('Rent', 'fixed');
    await insertCat('Food & Drink', 'flexible');
    await insertCat('Entertainment', 'discretionary');
    await insertTx({ amount: 1500, category: 'Rent' });
    await insertTx({ amount: 300, category: 'Food & Drink' });
    await insertTx({ amount: 100, category: 'Entertainment' });
    await insertTx({ amount: 200, category: 'Misc' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    const total = s.fixed + s.flexible + s.discretionary + s.untagged;
    expect(total).toBeCloseTo(2100);
  });

  it('excludes hidden categories', async () => {
    await db.execute({ sql: 'INSERT INTO hidden_categories VALUES (?)', args: ['Transfer'] });
    await insertCat('Transfer', 'fixed');
    await insertTx({ amount: 500, category: 'Transfer' });
    await insertTx({ amount: 100, category: 'Shopping' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.fixed).toBe(0);
    expect(s.untagged).toBeCloseTo(100);
  });

  it('excludes pending transactions', async () => {
    await insertCat('Rent', 'fixed');
    await insertTx({ amount: 1500, category: 'Rent', pending: 1 });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.fixed).toBe(0);
  });

  it('excludes ignored transactions', async () => {
    await insertCat('Rent', 'fixed');
    await insertTx({ amount: 1500, category: 'Rent', ignored: 1 });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.fixed).toBe(0);
  });

  it('respects date range', async () => {
    await insertCat('Rent', 'fixed');
    await insertTx({ date: '2025-01-15', amount: 1500, category: 'Rent' });
    await insertTx({ date: '2024-12-15', amount: 9999, category: 'Rent' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31');
    expect(s.fixed).toBeCloseTo(1500);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getRangeSummary with accountId', () => {
  it('filters to the given account', async () => {
    await insertTx({ amount: 100, category: 'Shopping', accountId: 'acct1' });
    await insertTx({ amount: 200, category: 'Dining',   accountId: 'acct2' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31', 'acct1');
    expect(s.expenses).toBeCloseTo(100);
    expect(s.byCategory).toHaveLength(1);
    expect(s.byCategory[0].category).toBe('Shopping');
  });

  it('returns zeros when account has no transactions in range', async () => {
    await insertTx({ amount: 100, accountId: 'acct2' });
    const s = await getRangeSummary('2025-01-01', '2025-01-31', 'acct1');
    expect(s.expenses).toBe(0);
    expect(s.income).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getMerchantSummary', () => {
  it('returns merchants ranked by net spend with counts and percentages', async () => {
    await insertTx({ amount: 120, category: 'Food & Drink', name: 'Blue Bottle' });
    await insertTx({ amount: 30, category: 'Food & Drink', name: 'Blue Bottle' });
    await insertTx({ amount: 50, category: 'Food & Drink', name: 'Chipotle' });

    const rows = await getMerchantSummary('Food & Drink', '2025-01-01', '2025-01-31');
    expect(rows).toHaveLength(2);
    expect(rows[0].merchant).toBe('Blue Bottle');
    expect(rows[0].total).toBeCloseTo(150);
    expect(rows[0].count).toBe(2);
    expect(rows[0].pct).toBeCloseTo(0.75);
    expect(rows[1].merchant).toBe('Chipotle');
    expect(rows[1].total).toBeCloseTo(50);
    expect(rows[1].count).toBe(1);
    expect(rows[1].pct).toBeCloseTo(0.25);
  });

  it('uses display_name when available and excludes non-positive net merchants', async () => {
    await insertTx({ amount: 100, category: 'Travel', name: 'LYFT *TRIP', displayName: 'Lyft' });
    await insertTx({ amount: -40, category: 'Travel', name: 'LYFT *REFUND', displayName: 'Lyft' });
    await insertTx({ amount: 20, category: 'Travel', name: 'Refund-only merchant' });
    await insertTx({ amount: -30, category: 'Travel', name: 'Refund-only merchant' });

    const rows = await getMerchantSummary('Travel', '2025-01-01', '2025-01-31');
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe('Lyft');
    expect(rows[0].total).toBeCloseTo(60);
    expect(rows[0].pct).toBeCloseTo(1);
  });

  it('respects account filter and excludes hidden/pending/ignored rows', async () => {
    await db.execute({ sql: "INSERT INTO hidden_categories VALUES (?)", args: ['Transfer'] });
    await insertTx({ amount: 90, category: 'Food', name: 'A', accountId: 'acct1' });
    await insertTx({ amount: 110, category: 'Food', name: 'B', accountId: 'acct2' });
    await insertTx({ amount: 200, category: 'Food', name: 'C', accountId: 'acct1', pending: 1 });
    await insertTx({ amount: 200, category: 'Food', name: 'D', accountId: 'acct1', ignored: 1 });
    await insertTx({ amount: 500, category: 'Transfer', name: 'E', accountId: 'acct1' });

    const rows = await getMerchantSummary('Food', '2025-01-01', '2025-01-31', 'acct1');
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe('A');
    expect(rows[0].total).toBeCloseTo(90);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getFlexSummary with accountId', () => {
  async function insertCat(name: string, flexibility: string) {
    await db.execute({ sql: 'INSERT INTO categories (name, flexibility) VALUES (?, ?)', args: [name, flexibility] });
  }

  it('filters to the given account', async () => {
    await insertCat('Rent', 'fixed');
    await insertTx({ amount: 1500, category: 'Rent', accountId: 'acct1' });
    await insertTx({ amount: 999,  category: 'Rent', accountId: 'acct2' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31', 'acct1');
    expect(s.fixed).toBeCloseTo(1500);
  });

  it('returns zeros when account has no transactions', async () => {
    await insertCat('Rent', 'fixed');
    await insertTx({ amount: 1500, category: 'Rent', accountId: 'acct2' });
    const s = await getFlexSummary('2025-01-01', '2025-01-31', 'acct1');
    expect(s.fixed).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getRecentTransactions', () => {
  it('returns empty array when no transactions', async () => {
    expect(await getRecentTransactions()).toHaveLength(0);
  });

  it('returns transactions ordered by date descending', async () => {
    await insertTx({ date: '2025-01-01', amount: 10 });
    await insertTx({ date: '2025-01-15', amount: 20 });
    await insertTx({ date: '2025-01-10', amount: 30 });
    const txs = await getRecentTransactions();
    expect(txs[0].date).toBe('2025-01-15');
    expect(txs[1].date).toBe('2025-01-10');
    expect(txs[2].date).toBe('2025-01-01');
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 15; i++) await insertTx({ amount: i });
    expect(await getRecentTransactions(5)).toHaveLength(5);
    expect(await getRecentTransactions(10)).toHaveLength(10);
  });

  it('excludes pending transactions', async () => {
    await insertTx({ amount: 100, pending: 1 });
    await insertTx({ amount: 200, pending: 0 });
    const txs = await getRecentTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('hasAccounts', () => {
  it('returns false when no accounts linked', async () => {
    await db.execute('DELETE FROM plaid_items');
    expect(await hasAccounts()).toBe(false);
  });

  it('returns true when at least one account is linked', async () => {
    await db.execute({
      sql: "INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES ('item1', 'tok_abc', 'Chase')",
      args: [],
    });
    expect(await hasAccounts()).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('getOwnerRows', () => {
  const RANGE = ['2025-01-01', '2025-01-31'] as const;
  const addAccount = (id: string, owner: string | null) =>
    db.execute({
      sql: "INSERT INTO accounts (id, name, type, owner) VALUES (?, ?, 'depository', ?)",
      args: [id, id, owner],
    });

  it('sums expenses per owner, sorted by spend descending', async () => {
    await addAccount('a1', 'Mark');
    await addAccount('a2', 'Partner');
    await insertTx({ accountId: 'a1', amount: 100 });
    await insertTx({ accountId: 'a1', amount: 50 });
    await insertTx({ accountId: 'a2', amount: 200 });
    const rows = await getOwnerRows(...RANGE);
    expect(rows).toEqual([
      { owner: 'Partner', spending: 200 },
      { owner: 'Mark', spending: 150 },
    ]);
  });

  it('buckets accounts with no owner under Unassigned', async () => {
    await addAccount('a1', 'Mark');
    await addAccount('a2', null);
    await addAccount('a3', '   '); // whitespace-only owner counts as unassigned
    await insertTx({ accountId: 'a1', amount: 100 });
    await insertTx({ accountId: 'a2', amount: 75 });
    await insertTx({ accountId: 'a3', amount: 25 });
    const rows = await getOwnerRows(...RANGE);
    expect(rows.find((r) => r.owner === 'Unassigned')?.spending).toBe(100);
  });

  it('lists an owned account even when it has no spend this period (zero row)', async () => {
    await addAccount('a1', 'Mark');
    const rows = await getOwnerRows(...RANGE);
    expect(rows).toEqual([{ owner: 'Mark', spending: 0 }]);
  });

  it('returns no rows when there are no accounts', async () => {
    await insertTx({ amount: 100 }); // orphan tx, no account row
    expect(await getOwnerRows(...RANGE)).toEqual([]);
  });

  it('excludes income, pending, ignored, hidden categories, and out-of-range txns', async () => {
    await db.execute({ sql: 'INSERT INTO hidden_categories VALUES (?)', args: ['Transfer'] });
    await addAccount('a1', 'Mark');
    await insertTx({ accountId: 'a1', amount: 100 });                      // counts
    await insertTx({ accountId: 'a1', amount: -500 });                     // income, excluded
    await insertTx({ accountId: 'a1', amount: 40, pending: 1 });           // pending, excluded
    await insertTx({ accountId: 'a1', amount: 40, ignored: 1 });           // ignored, excluded
    await insertTx({ accountId: 'a1', amount: 40, category: 'Transfer' }); // hidden, excluded
    await insertTx({ accountId: 'a1', amount: 999, date: '2024-12-31' });  // out of range, excluded
    const rows = await getOwnerRows(...RANGE);
    expect(rows).toEqual([{ owner: 'Mark', spending: 100 }]);
  });
});

// ──────────────────────────────────────────────────────────────────────
describe('tag filter (has / lacks)', () => {
  const RANGE = ['2025-01-01', '2025-01-31'] as const;

  it('getRangeSummary "has" keeps only tagged transactions', async () => {
    const a = await insertTx({ amount: 100, category: 'Shopping' });
    await insertTx({ amount: 250, category: 'Dining' });
    await tagTxs('reimbursable', [a]);
    const s = await getRangeSummary(...RANGE, undefined, { name: 'reimbursable', mode: 'has' });
    expect(s.expenses).toBeCloseTo(100);
    expect(s.byCategory).toEqual([{ category: 'Shopping', total: 100 }]);
  });

  it('getRangeSummary "lacks" keeps only untagged transactions', async () => {
    const a = await insertTx({ amount: 100, category: 'Shopping' });
    await insertTx({ amount: 250, category: 'Dining' });
    await tagTxs('reimbursable', [a]);
    const s = await getRangeSummary(...RANGE, undefined, { name: 'reimbursable', mode: 'lacks' });
    expect(s.expenses).toBeCloseTo(250);
    expect(s.byCategory).toEqual([{ category: 'Dining', total: 250 }]);
  });

  it('has + lacks partition the unfiltered total', async () => {
    const a = await insertTx({ amount: 100, category: 'Shopping' });
    await insertTx({ amount: 250, category: 'Dining' });
    await tagTxs('reimbursable', [a]);
    const all   = await getRangeSummary(...RANGE);
    const has   = await getRangeSummary(...RANGE, undefined, { name: 'reimbursable', mode: 'has' });
    const lacks = await getRangeSummary(...RANGE, undefined, { name: 'reimbursable', mode: 'lacks' });
    expect(has.expenses + lacks.expenses).toBeCloseTo(all.expenses);
  });

  it('an unknown tag name matches nothing for "has" and everything for "lacks"', async () => {
    await insertTx({ amount: 100, category: 'Shopping' });
    const has   = await getRangeSummary(...RANGE, undefined, { name: 'nope', mode: 'has' });
    const lacks = await getRangeSummary(...RANGE, undefined, { name: 'nope', mode: 'lacks' });
    expect(has.expenses).toBe(0);
    expect(lacks.expenses).toBeCloseTo(100);
  });

  it('composes with the account filter', async () => {
    const a = await insertTx({ amount: 100, category: 'Shopping', accountId: 'acct1' });
    await insertTx({ amount: 70, category: 'Shopping', accountId: 'acct1' });   // tagged but wrong account excluded by account filter
    const b = await insertTx({ amount: 200, category: 'Dining', accountId: 'acct2' });
    await tagTxs('reimbursable', [a, b]);
    const s = await getRangeSummary(...RANGE, 'acct1', { name: 'reimbursable', mode: 'has' });
    expect(s.expenses).toBeCloseTo(100);
  });

  it('getFlexSummary respects the tag filter', async () => {
    await db.execute({ sql: 'INSERT INTO categories (name, flexibility) VALUES (?, ?)', args: ['Rent', 'fixed'] });
    const a = await insertTx({ amount: 1500, category: 'Rent' });
    await insertTx({ amount: 900, category: 'Rent' });
    await tagTxs('shared', [a]);
    expect((await getFlexSummary(...RANGE, undefined, { name: 'shared', mode: 'has' })).fixed).toBeCloseTo(1500);
    expect((await getFlexSummary(...RANGE, undefined, { name: 'shared', mode: 'lacks' })).fixed).toBeCloseTo(900);
  });

  it('getMerchantSummary respects the tag filter', async () => {
    const a = await insertTx({ amount: 120, category: 'Food', name: 'Blue Bottle' });
    await insertTx({ amount: 80, category: 'Food', name: 'Chipotle' });
    await tagTxs('work', [a]);
    const rows = await getMerchantSummary('Food', ...RANGE, undefined, { name: 'work', mode: 'has' });
    expect(rows).toHaveLength(1);
    expect(rows[0].merchant).toBe('Blue Bottle');
    expect(rows[0].total).toBeCloseTo(120);
  });

  it('getOwnerRows respects the tag filter', async () => {
    await db.execute({ sql: "INSERT INTO accounts (id, name, type, owner) VALUES ('a1', 'a1', 'depository', 'Mark')", args: [] });
    const a = await insertTx({ accountId: 'a1', amount: 100 });
    await insertTx({ accountId: 'a1', amount: 30 });
    await tagTxs('shared', [a]);
    const rows = await getOwnerRows(...RANGE, { name: 'shared', mode: 'has' });
    expect(rows).toEqual([{ owner: 'Mark', spending: 100 }]);
  });
});
