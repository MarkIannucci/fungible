import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

// Plaid client is mocked per-test via this mutable handle.
let plaidClient: {
  transactionsSync: ReturnType<typeof vi.fn>;
  accountsGet: ReturnType<typeof vi.fn>;
};
vi.mock('../core/plaid.js', () => ({
  getPlaidClient: () => plaidClient,
}));

import { db } from '../core/db.js';
import { syncAll, syncTransactions, describeSyncProgress, type SyncProgress } from '../core/sync.js';

beforeEach(async () => {
  for (const t of ['transactions', 'accounts', 'sync_state', 'plaid_items']) {
    await db.execute(`DELETE FROM ${t}`);
  }
});

/** A Plaid client that reports nothing to sync — enough to drive syncAll's loop. */
function mockPlaid() {
  plaidClient = {
    transactionsSync: vi.fn().mockResolvedValue({
      data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'cursor-1' },
    }),
    accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
  };
}

describe('syncAll item filter', () => {
  // access_token is stored plaintext here: decryptToken passes through any value
  // that isn't an iv:authTag:ciphertext triple, so no key file is needed.
  async function seedItems(...itemIds: string[]) {
    await db.batch(
      itemIds.map((id) => ({
        sql: 'INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES (?, ?, ?)',
        args: [id, `tok-${id}`, id],
      })),
      'write',
    );
  }

  const syncedItemIds = async () => {
    const res = await db.execute('SELECT item_id FROM plaid_items WHERE last_synced_at IS NOT NULL ORDER BY item_id');
    return (res.rows as unknown as { item_id: string }[]).map((r) => r.item_id);
  };

  const cursorItemIds = async () => {
    const res = await db.execute('SELECT account_id FROM sync_state ORDER BY account_id');
    return (res.rows as unknown as { account_id: string }[]).map((r) => r.account_id);
  };

  it('syncs only the requested item', async () => {
    await seedItems('item-a', 'item-b');
    mockPlaid();

    const results = await syncAll(true, ['item-a']);

    expect(results.map((r) => r.itemId)).toEqual(['item-a']);
    expect(await syncedItemIds()).toEqual(['item-a']);
    expect(await cursorItemIds()).toEqual(['item-a']);
    // One item, one Plaid round trip — item-b was never contacted.
    expect(plaidClient.transactionsSync).toHaveBeenCalledTimes(1);
    expect(plaidClient.transactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'tok-item-a' }),
    );
  });

  it('syncs every item when no filter is given', async () => {
    await seedItems('item-a', 'item-b');
    mockPlaid();

    const results = await syncAll(true);

    expect(results.map((r) => r.itemId).sort()).toEqual(['item-a', 'item-b']);
    expect(await syncedItemIds()).toEqual(['item-a', 'item-b']);
  });

  it('treats an empty filter as unfiltered', async () => {
    await seedItems('item-a', 'item-b');
    mockPlaid();

    const results = await syncAll(true, []);

    expect(results.map((r) => r.itemId).sort()).toEqual(['item-a', 'item-b']);
  });

  it('syncs several named items and skips the rest', async () => {
    await seedItems('item-a', 'item-b', 'item-c');
    mockPlaid();

    await syncAll(true, ['item-a', 'item-c']);

    expect(await syncedItemIds()).toEqual(['item-a', 'item-c']);
  });

  it('returns no results for an item id that does not exist', async () => {
    await seedItems('item-a');
    mockPlaid();

    expect(await syncAll(true, ['item-nope'])).toEqual([]);
    expect(await syncedItemIds()).toEqual([]);
  });
});

describe('sync progress reporting', () => {
  async function seedItem(id: string) {
    await db.execute({
      sql: 'INSERT INTO plaid_items (item_id, access_token, institution_name) VALUES (?, ?, ?)',
      args: [id, `tok-${id}`, id],
    });
  }

  it('reports each phase, tagged with the item it belongs to', async () => {
    await seedItem('item-a');
    mockPlaid();

    const seen: [string, SyncProgress][] = [];
    await syncAll(true, ['item-a'], (itemId, p) => seen.push([itemId, p]));

    expect(seen.every(([id]) => id === 'item-a')).toBe(true);
    // Nothing to categorise or remove in an empty sync, so those phases are absent.
    expect(seen.map(([, p]) => p.phase)).toEqual(['transactions', 'accounts', 'dedup']);
  });

  it('reports the transactions phase before the first request, so page 1 is not silent', async () => {
    await seedItem('item-a');
    mockPlaid();

    const seen: SyncProgress[] = [];
    await syncTransactions('tok', 'item-a', (p) => seen.push(p));

    expect(seen[0]).toEqual({ phase: 'transactions', page: 1, fetched: 0 });
  });

  it('emits one transactions step per page and carries the running count', async () => {
    await seedItem('item-a');
    // Two pages: has_more flips false on the second response.
    const tx = (id: string) => ({
      transaction_id: id, account_id: 'acct1', date: '2025-01-01', name: 'X',
      amount: 1, pending: false, personal_finance_category: null, merchant_name: null,
    });
    let call = 0;
    plaidClient = {
      transactionsSync: vi.fn().mockImplementation(() => {
        call++;
        return Promise.resolve({
          data: {
            added: [tx(`t${call}a`), tx(`t${call}b`)], modified: [], removed: [],
            has_more: call < 2, next_cursor: `cursor-${call}`,
          },
        });
      }),
      accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
    };

    const seen: SyncProgress[] = [];
    await syncTransactions('tok', 'item-a', (p) => seen.push(p));

    const pages = seen.filter((p) => p.phase === 'transactions');
    expect(pages).toEqual([
      { phase: 'transactions', page: 1, fetched: 0 },
      { phase: 'transactions', page: 2, fetched: 2 },
    ]);
    // The write phases show up once there is something to write.
    expect(seen.map((p) => p.phase)).toContain('categorize');
    expect(seen.map((p) => p.phase)).toContain('tag-rules');
  });

  it('stays optional — a sync with no callback still completes', async () => {
    await seedItem('item-a');
    mockPlaid();
    const results = await syncAll(true, ['item-a']);
    expect(results[0].error).toBeUndefined();
  });
});

describe('describeSyncProgress', () => {
  it('renders each phase as user-facing text', () => {
    expect(describeSyncProgress({ phase: 'transactions', page: 1, fetched: 1234 }))
      .toBe('Fetching transactions… 1,234 so far');
    expect(describeSyncProgress({ phase: 'accounts' })).toBe('Fetching accounts & balances…');
    expect(describeSyncProgress({ phase: 'categorize', count: 1 })).toBe('Categorizing 1 transaction…');
    expect(describeSyncProgress({ phase: 'categorize', count: 2000 })).toBe('Categorizing 2,000 transactions…');
    expect(describeSyncProgress({ phase: 'tag-rules', count: 5 })).toBe('Applying tag rules…');
    expect(describeSyncProgress({ phase: 'remove', count: 1 })).toBe('Removing 1 deleted transaction…');
    expect(describeSyncProgress({ phase: 'dedup' })).toBe('Checking for duplicates…');
  });
});
