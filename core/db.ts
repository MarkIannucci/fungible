import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DATA_DIR = path.join(os.homedir(), '.fungible');
const DB_PATH = path.join(DATA_DIR, 'fungible.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT,
      institution_name TEXT,
      mask TEXT
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      merchant_name TEXT,
      amount REAL NOT NULL,
      category TEXT,
      raw_category TEXT,
      pending INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);

    CREATE TABLE IF NOT EXISTS category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      priority INTEGER NOT NULL DEFAULT 0,
      match_type TEXT NOT NULL CHECK(match_type IN ('name', 'regex')),
      pattern TEXT NOT NULL,
      category TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      account_id TEXT PRIMARY KEY,
      cursor TEXT
    );

    CREATE TABLE IF NOT EXISTS plaid_items (
      item_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      institution_name TEXT
    );

    CREATE TABLE IF NOT EXISTS hidden_categories (
      category TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS name_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_type TEXT NOT NULL CHECK(match_type IN ('name', 'regex')),
      pattern TEXT NOT NULL,
      replacement TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS transaction_tags (
      transaction_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (transaction_id, tag_id),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id),
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );
  `);

  // Add manual_category column if not present (migration)
  try { db.exec('ALTER TABLE transactions ADD COLUMN manual_category TEXT'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN display_name TEXT'); } catch {}
  try { db.exec('ALTER TABLE transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE category_rules ADD COLUMN min_amount REAL'); } catch {}
  try { db.exec('ALTER TABLE category_rules ADD COLUMN max_amount REAL'); } catch {}
  try { db.exec('ALTER TABLE name_rules ADD COLUMN min_amount REAL'); } catch {}
  try { db.exec('ALTER TABLE name_rules ADD COLUMN max_amount REAL'); } catch {}
  try { db.exec("ALTER TABLE categories ADD COLUMN flexibility TEXT CHECK(flexibility IN ('fixed','flexible','discretionary'))"); } catch {}
  try { db.exec('ALTER TABLE plaid_items ADD COLUMN last_synced_at INTEGER'); } catch {}
  // Seed default flexibility tiers (only for categories that don't have one set yet)
  const flexDefaults: [string, string][] = [
    ['Rent', 'fixed'], ['Insurance', 'fixed'], ['Childcare', 'fixed'],
    ['Loan Payment', 'fixed'], ['Taxes', 'fixed'], ['Government', 'fixed'],
    ['Bills & Utilities', 'fixed'], ['Medical', 'fixed'],
    ['Food & Drink', 'flexible'], ['Grocery', 'flexible'], ['Transportation', 'flexible'],
    ['Personal Care', 'flexible'], ['Home', 'flexible'], ['Services', 'flexible'],
    ['Shopping', 'discretionary'], ['Entertainment', 'discretionary'],
    ['Travel', 'discretionary'], ['Dining', 'discretionary'], ['Fees', 'discretionary'],
  ];
  const setFlex = db.prepare(
    "UPDATE categories SET flexibility = ? WHERE name = ? AND flexibility IS NULL"
  );
  for (const [cat, flex] of flexDefaults) setFlex.run(flex, cat);

  // Fix Venmo phone bill name rule — restrict to $54.79 only
  db.prepare(
    `UPDATE name_rules SET min_amount = 54.79, max_amount = 54.79
     WHERE pattern = 'VENMO PAYMENT' AND replacement = 'Phone Bill' AND min_amount IS NULL`
  ).run();

  // Seed default hidden categories (idempotent)
  const hidden = ['Transfer', 'Loan Payment'];
  const insertHidden = db.prepare('INSERT OR IGNORE INTO hidden_categories (category) VALUES (?)');
  for (const cat of hidden) insertHidden.run(cat);

  // Seed default categories (idempotent)
  const defaultCategories = [
    'Income', 'Transfer', 'Food & Drink', 'Shopping', 'Transportation',
    'Travel', 'Bills & Utilities', 'Insurance', 'Medical', 'Personal Care',
    'Childcare', 'Entertainment', 'Home', 'Services', 'Fees',
    'Government', 'Taxes', 'Loan Payment', 'Uncategorized',
  ];
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  for (const cat of defaultCategories) insertCat.run(cat);
}
