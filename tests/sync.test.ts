import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

vi.mock('../core/plaid.js', () => ({
  getPlaidClient: vi.fn(),
  plaidErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { db } from '../core/db.js';
import { getPlaidClient } from '../core/plaid.js';
import { syncTransactions } from '../core/sync.js';

const mockPlaid = (removed: string[], added: object[] = []) => {
  vi.mocked(getPlaidClient).mockReturnValue({
    transactionsSync: vi.fn().mockResolvedValue({
      data: {
        added,
        modified: [],
        removed: removed.map((id) => ({ transaction_id: id })),
        has_more: false,
        next_cursor: 'cursor-1',
      },
    }),
    accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
  } as never);
};

beforeEach(async () => {
  for (const t of ['transaction_tags', 'tag_rule_suppressions', 'tag_rules', 'tags', 'transactions', 'accounts', 'sync_state', 'balance_history']) {
    await db.execute(`DELETE FROM ${t}`);
  }
});

async function insertTx(id: string) {
  await db.execute({ sql: `INSERT INTO transactions (id, account_id, date, name, amount, category, pending, ignored) VALUES (?, 'acct-1', '2025-01-01', 'Test', 10, 'Food', 0, 0)`, args: [id] });
}

async function insertTag(name: string): Promise<number> {
  await db.execute({ sql: 'INSERT INTO tags (name) VALUES (?)', args: [name] });
  const r = await db.execute({ sql: 'SELECT id FROM tags WHERE name = ?', args: [name] });
  return Number((r.rows[0] as { id: number }).id);
}

describe('syncTransactions — removing tagged transactions', () => {
  it('deletes transaction_tags before the transaction to avoid FK constraint failure', async () => {
    await insertTx('tx-1');
    const tagId = await insertTag('groceries');
    await db.execute({ sql: 'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', args: ['tx-1', tagId] });

    mockPlaid(['tx-1']);
    await expect(syncTransactions('token', 'item-1')).resolves.not.toThrow();

    const tags = await db.execute({ sql: 'SELECT * FROM transaction_tags WHERE transaction_id = ?', args: ['tx-1'] });
    const txs = await db.execute({ sql: 'SELECT * FROM transactions WHERE id = ?', args: ['tx-1'] });
    expect(tags.rows).toHaveLength(0);
    expect(txs.rows).toHaveLength(0);
  });

  it('also clears tag_rule_suppressions for removed transactions', async () => {
    await insertTx('tx-2');
    const tagId = await insertTag('travel');
    await db.execute({ sql: 'INSERT INTO tag_rule_suppressions (transaction_id, tag_id) VALUES (?, ?)', args: ['tx-2', tagId] });

    mockPlaid(['tx-2']);
    await syncTransactions('token', 'item-1');

    const rows = await db.execute({ sql: 'SELECT * FROM tag_rule_suppressions WHERE transaction_id = ?', args: ['tx-2'] });
    expect(rows.rows).toHaveLength(0);
  });

  it('leaves unrelated transactions and tags intact', async () => {
    await insertTx('tx-keep');
    await insertTx('tx-remove');
    const tagId = await insertTag('dining');
    await db.execute({ sql: 'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', args: ['tx-keep', tagId] });
    await db.execute({ sql: 'INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', args: ['tx-remove', tagId] });

    mockPlaid(['tx-remove']);
    await syncTransactions('token', 'item-1');

    const kept = await db.execute({ sql: 'SELECT * FROM transaction_tags WHERE transaction_id = ?', args: ['tx-keep'] });
    expect(kept.rows).toHaveLength(1);
  });
});
