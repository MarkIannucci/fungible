import { describe, it, expect, beforeEach, vi } from 'vitest';

const itemRemove = vi.fn();
const accountsGet = vi.fn();
const transactionsSync = vi.fn();

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});
vi.mock('../core/plaid.js', () => ({
  getPlaidClient: () => ({ itemRemove, accountsGet, transactionsSync }),
  isPlaidConfigured: () => true,
}));
vi.mock('../core/crypto.js', () => ({
  decryptToken: (t: string) => t,
  encryptToken: (t: string) => t,
}));
vi.mock('../core/dedup.js', () => ({ deduplicateCsvVsPlaid: () => Promise.resolve(0) }));

import { db } from '../core/db.js';
import { removeLink, syncTransactions } from '../core/sync.js';

async function count(table: string, where = '', args: string[] = []): Promise<number> {
  const res = await db.execute({ sql: `SELECT COUNT(*) c FROM ${table} ${where}`, args });
  return Number((res.rows[0] as unknown as { c: number }).c);
}

async function seedLink(itemId: string, accts: string[]) {
  await db.execute({ sql: "INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES (?, 'tok', 'Fidelity')", args: [itemId] });
  await db.execute({ sql: "INSERT INTO sync_state (account_id, cursor) VALUES (?, 'cur')", args: [itemId] });
  for (const a of accts) {
    await db.execute({ sql: "INSERT INTO accounts (id, name, type, item_id) VALUES (?, ?, 'depository', ?)", args: [a, a, itemId] });
    await db.execute({ sql: "INSERT INTO transactions (id, account_id, date, name, amount) VALUES (?, ?, '2025-01-01', 'tx', 1)", args: [`tx-${a}`, a] });
    await db.execute({ sql: "INSERT INTO balance_history (account_id, balance, date) VALUES (?, 100, '2025-01-01')", args: [a] });
    await db.execute({ sql: 'INSERT INTO tags (name) VALUES (?)', args: [`tag-${a}`] });
    const tagRes = await db.execute({ sql: 'SELECT id FROM tags WHERE name = ?', args: [`tag-${a}`] });
    const tagId = Number((tagRes.rows[0] as unknown as { id: number }).id);
    await db.execute({ sql: 'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', args: [`tx-${a}`, tagId] });
  }
}

function plaidAccount(id: string) {
  return { account_id: id, name: id, type: 'depository', subtype: 'checking', mask: null, balances: { current: 100 } };
}

beforeEach(async () => {
  itemRemove.mockReset();
  itemRemove.mockResolvedValue({});
  accountsGet.mockReset();
  transactionsSync.mockReset();
  transactionsSync.mockResolvedValue({ data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cur' } });
  for (const t of ['transaction_tags', 'transactions', 'balance_history', 'accounts', 'sync_state', 'plaid_items', 'tags', 'excluded_plaid_accounts']) {
    await db.execute(`DELETE FROM ${t}`);
  }
});

describe('removeLink', () => {
  it('deletes only the targeted item and leaves a sibling link untouched', async () => {
    await seedLink('itemA', ['a1', 'a2']);
    await seedLink('itemB', ['b1']);

    const res = await removeLink('itemA');

    expect(res.plaidRemoved).toBe(true);
    expect(itemRemove).toHaveBeenCalledTimes(1);

    // itemA fully gone across every table
    expect(await count('plaid_items', 'WHERE item_id = ?', ['itemA'])).toBe(0);
    expect(await count('sync_state', 'WHERE account_id = ?', ['itemA'])).toBe(0);
    expect(await count('accounts', 'WHERE item_id = ?', ['itemA'])).toBe(0);
    expect(await count('transactions', "WHERE account_id IN ('a1','a2')")).toBe(0);
    expect(await count('balance_history', "WHERE account_id IN ('a1','a2')")).toBe(0);
    expect(await count('transaction_tags')).toBe(1); // only b1's tag link survives

    // itemB intact
    expect(await count('plaid_items', 'WHERE item_id = ?', ['itemB'])).toBe(1);
    expect(await count('accounts', 'WHERE item_id = ?', ['itemB'])).toBe(1);
    expect(await count('transactions', "WHERE account_id = 'b1'")).toBe(1);
  });

  it('still performs local cleanup when Plaid item removal fails', async () => {
    itemRemove.mockRejectedValue(new Error('invalid token'));
    await seedLink('itemA', ['a1']);

    const res = await removeLink('itemA');

    expect(res.plaidRemoved).toBe(false);
    expect(await count('plaid_items')).toBe(0);
    expect(await count('accounts')).toBe(0);
    expect(await count('transactions')).toBe(0);
  });

  it('does not touch CSV/manual accounts that have a null item_id', async () => {
    await seedLink('itemA', ['a1']);
    await db.execute("INSERT INTO accounts (id, name, type, item_id) VALUES ('csv-acct-1', 'Manual', 'depository', NULL)");
    await db.execute("INSERT INTO transactions (id, account_id, date, name, amount) VALUES ('tx-csv', 'csv-acct-1', '2025-01-01', 'tx', 1)");

    await removeLink('itemA');

    expect(await count('accounts', "WHERE id = 'csv-acct-1'")).toBe(1);
    expect(await count('transactions', "WHERE account_id = 'csv-acct-1'")).toBe(1);
  });
});

describe('syncTransactions — excluded accounts', () => {
  it('does not recreate an account whose id is in excluded_plaid_accounts', async () => {
    await db.execute("INSERT INTO excluded_plaid_accounts (account_id) VALUES ('a1')");
    accountsGet.mockResolvedValue({ data: { accounts: [plaidAccount('a1'), plaidAccount('a2')] } });

    await syncTransactions('tok', 'itemX');

    expect(await count('accounts', "WHERE id = 'a1'")).toBe(0);
    expect(await count('accounts', "WHERE id = 'a2'")).toBe(1);
  });

  it('does not snapshot a balance for an excluded account', async () => {
    await db.execute("INSERT INTO excluded_plaid_accounts (account_id) VALUES ('a1')");
    accountsGet.mockResolvedValue({ data: { accounts: [plaidAccount('a1')] } });

    await syncTransactions('tok', 'itemX');

    expect(await count('balance_history', "WHERE account_id = 'a1'")).toBe(0);
  });

  it('tags synced accounts with their item_id', async () => {
    accountsGet.mockResolvedValue({ data: { accounts: [plaidAccount('a1')] } });

    await syncTransactions('tok', 'itemX');

    expect(await count('accounts', "WHERE id = 'a1' AND item_id = 'itemX'")).toBe(1);
  });
});
