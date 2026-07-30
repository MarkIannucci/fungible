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
import { syncAll } from '../core/sync.js';

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
