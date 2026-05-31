import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

import { db } from '../core/db.js';
import { deleteAccount } from '../core/accounts.js';
import { getPlaidLinks } from '../core/queries.js';

async function count(table: string, where = '', args: string[] = []): Promise<number> {
  const res = await db.execute({ sql: `SELECT COUNT(*) c FROM ${table} ${where}`, args });
  return Number((res.rows[0] as unknown as { c: number }).c);
}

beforeEach(async () => {
  for (const t of ['transactions', 'balance_history', 'accounts', 'plaid_items', 'excluded_plaid_accounts']) {
    await db.execute(`DELETE FROM ${t}`);
  }
});

describe('deleteAccount', () => {
  it('tombstones a Plaid-backed account so sync will not recreate it', async () => {
    await db.execute("INSERT INTO accounts (id, name, type, item_id) VALUES ('a1', 'Checking', 'depository', 'itemA')");

    await deleteAccount('a1');

    expect(await count('accounts', "WHERE id = 'a1'")).toBe(0);
    expect(await count('excluded_plaid_accounts', "WHERE account_id = 'a1'")).toBe(1);
  });

  it('does not tombstone CSV/manual accounts (null item_id)', async () => {
    await db.execute("INSERT INTO accounts (id, name, type, item_id) VALUES ('csv-acct-1', 'Manual', 'depository', NULL)");

    await deleteAccount('csv-acct-1');

    expect(await count('accounts', "WHERE id = 'csv-acct-1'")).toBe(0);
    expect(await count('excluded_plaid_accounts')).toBe(0);
  });
});

describe('getPlaidLinks', () => {
  it('counts only accounts whose item_id matches the link', async () => {
    await db.execute("INSERT INTO plaid_items (item_id, access_token, institution_name, last_synced_at) VALUES ('itemA', 'tok', 'Fidelity', 123)");
    await db.execute("INSERT INTO plaid_items (item_id, access_token, institution_name, last_synced_at) VALUES ('itemB', 'tok', 'Fidelity', NULL)");
    await db.execute("INSERT INTO accounts (id, name, type, item_id) VALUES ('a1', 'Checking', 'depository', 'itemA')");
    await db.execute("INSERT INTO accounts (id, name, type, item_id) VALUES ('a2', 'Savings', 'depository', 'itemA')");
    await db.execute("INSERT INTO accounts (id, name, type, item_id) VALUES ('b1', 'Brokerage', 'investment', 'itemB')");
    await db.execute("INSERT INTO accounts (id, name, type, item_id) VALUES ('csv-acct-1', 'Manual', 'depository', NULL)");

    const links = await getPlaidLinks();

    expect(links.map((l) => [l.item_id, Number(l.account_count)])).toEqual([
      ['itemA', 2],
      ['itemB', 1],
    ]);
    expect(links[1].last_synced_at).toBeNull();
  });
});
