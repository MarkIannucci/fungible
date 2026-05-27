import { describe, it, expect, beforeEach, vi } from 'vitest';

const itemRemove = vi.fn();
const accountsGet = vi.fn();
const transactionsSync = vi.fn();

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: makeTestDb() };
});
vi.mock('../core/plaid.js', () => ({
  getPlaidClient: () => ({ itemRemove, accountsGet, transactionsSync }),
  isPlaidConfigured: () => true,
}));
vi.mock('../core/crypto.js', () => ({
  decryptToken: (t: string) => t,
  encryptToken: (t: string) => t,
}));
vi.mock('../core/categorize.js', () => ({ categorize: () => 'Uncategorized' }));
vi.mock('../core/rename.js', () => ({ applyNameRules: (n: string) => n }));
vi.mock('../core/dedup.js', () => ({ deduplicateCsvVsPlaid: () => 0 }));

import { db } from '../core/db.js';
import { removeLink, syncTransactions } from '../core/sync.js';

const count = (table: string, where = '', ...args: string[]) =>
  (db.prepare(`SELECT COUNT(*) c FROM ${table} ${where}`).get(...args) as { c: number }).c;

function seedLink(itemId: string, accts: string[]) {
  db.prepare("INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES (?, 'tok', 'Fidelity')").run(itemId);
  db.prepare("INSERT INTO sync_state (account_id, cursor) VALUES (?, 'cur')").run(itemId);
  for (const a of accts) {
    db.prepare("INSERT INTO accounts (id, name, type, item_id) VALUES (?, ?, 'depository', ?)").run(a, a, itemId);
    db.prepare("INSERT INTO transactions (id, account_id, date, name, amount) VALUES (?, ?, '2025-01-01', 'tx', 1)").run(`tx-${a}`, a);
    db.prepare("INSERT INTO balance_history (account_id, balance, date) VALUES (?, 100, '2025-01-01')").run(a);
    db.prepare("INSERT INTO tags (name) VALUES (?)").run(`tag-${a}`);
    const tagId = (db.prepare('SELECT id FROM tags WHERE name = ?').get(`tag-${a}`) as { id: number }).id;
    db.prepare("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)").run(`tx-${a}`, tagId);
  }
}

function makePlaidAccount(id: string) {
  return { account_id: id, name: id, type: 'depository', subtype: 'checking', mask: null, balances: { current: 100 } };
}

beforeEach(() => {
  itemRemove.mockReset();
  itemRemove.mockResolvedValue({});
  accountsGet.mockReset();
  transactionsSync.mockReset();
  transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cur' } });
  for (const t of ['transaction_tags', 'transactions', 'balance_history', 'accounts', 'sync_state', 'plaid_items', 'tags', 'excluded_plaid_accounts']) {
    db.exec(`DELETE FROM ${t}`);
  }
});

describe('removeLink', () => {
  it('deletes only the targeted item and leaves a sibling link untouched', async () => {
    seedLink('itemA', ['a1', 'a2']);
    seedLink('itemB', ['b1']);

    const res = await removeLink('itemA');

    expect(res.plaidRemoved).toBe(true);
    expect(itemRemove).toHaveBeenCalledTimes(1);

    // itemA fully gone across every table
    expect(count('plaid_items', 'WHERE item_id = ?', 'itemA')).toBe(0);
    expect(count('sync_state', 'WHERE account_id = ?', 'itemA')).toBe(0);
    expect(count('accounts', 'WHERE item_id = ?', 'itemA')).toBe(0);
    expect(count('transactions', "WHERE account_id IN ('a1','a2')")).toBe(0);
    expect(count('balance_history', "WHERE account_id IN ('a1','a2')")).toBe(0);
    expect(count('transaction_tags')).toBe(1); // only b1's tag link survives

    // itemB intact
    expect(count('plaid_items', 'WHERE item_id = ?', 'itemB')).toBe(1);
    expect(count('accounts', 'WHERE item_id = ?', 'itemB')).toBe(1);
    expect(count('transactions', "WHERE account_id = 'b1'")).toBe(1);
  });

  it('still performs local cleanup when Plaid item removal fails', async () => {
    itemRemove.mockRejectedValue(new Error('invalid token'));
    seedLink('itemA', ['a1']);

    const res = await removeLink('itemA');

    expect(res.plaidRemoved).toBe(false);
    expect(count('plaid_items')).toBe(0);
    expect(count('accounts')).toBe(0);
    expect(count('transactions')).toBe(0);
  });

  it('does not touch CSV/manual accounts that have a null item_id', async () => {
    seedLink('itemA', ['a1']);
    db.prepare("INSERT INTO accounts (id, name, type, item_id) VALUES ('csv-acct-1', 'Manual', 'depository', NULL)").run();
    db.prepare("INSERT INTO transactions (id, account_id, date, name, amount) VALUES ('tx-csv', 'csv-acct-1', '2025-01-01', 'tx', 1)").run();

    await removeLink('itemA');

    expect(count('accounts', "WHERE id = 'csv-acct-1'")).toBe(1);
    expect(count('transactions', "WHERE account_id = 'csv-acct-1'")).toBe(1);
  });
});

describe('syncTransactions — excluded accounts', () => {
  it('does not recreate an account whose id is in excluded_plaid_accounts', async () => {
    db.prepare("INSERT INTO excluded_plaid_accounts (account_id) VALUES ('a1')").run();
    accountsGet.mockResolvedValue({ data: { accounts: [makePlaidAccount('a1'), makePlaidAccount('a2')] } });

    await syncTransactions('tok', 'itemX');

    expect(count('accounts', "WHERE id = 'a1'")).toBe(0);
    expect(count('accounts', "WHERE id = 'a2'")).toBe(1);
  });

  it('does not snapshot a balance for an excluded account', async () => {
    db.prepare("INSERT INTO excluded_plaid_accounts (account_id) VALUES ('a1')").run();
    accountsGet.mockResolvedValue({ data: { accounts: [makePlaidAccount('a1')] } });

    await syncTransactions('tok', 'itemX');

    expect(count('balance_history', "WHERE account_id = 'a1'")).toBe(0);
  });
});
