import { describe, it, expect, vi, afterAll } from 'vitest';
import type { AccountBase } from 'plaid';

const { TEST_DATA_DIR } = vi.hoisted(() => {
  const os = require('os') as typeof import('os');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = path.join(os.tmpdir(), `fungible-balances-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return { TEST_DATA_DIR: dir };
});

// The script imports core/db.js, which creates its client under DATA_DIR at
// module load. Point that at a temp dir so importing it never touches ~/.fungible.
vi.mock('../core/paths.js', () => ({ DATA_DIR: TEST_DATA_DIR }));

import { compareBalances, classifyUnfetched, type LocalAccount } from '../scripts/plaid-balances.js';

afterAll(() => {
  const fs = require('fs') as typeof import('fs');
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function plaidAccount(
  account_id: string,
  balances: Partial<AccountBase['balances']> = {},
  over: Partial<AccountBase> = {},
): AccountBase {
  return {
    account_id, name: 'Checking', mask: '0000', type: 'depository', subtype: 'checking',
    balances: {
      current: 100, available: null, limit: null,
      iso_currency_code: 'USD', unofficial_currency_code: null, ...balances,
    },
    ...over,
  } as AccountBase;
}

const item = (accounts: AccountBase[]) =>
  [{ itemId: 'item-1', institution: 'Chase', accounts }];

function localAccount(id: string, over: Partial<LocalAccount> = {}): LocalAccount {
  return {
    id, name: 'Checking', nickname: null, type: 'depository', mask: '0000',
    item_id: 'item-1', balance: 100, balance_date: '2026-08-01', ...over,
  };
}

describe('compareBalances', () => {
  it('reports no delta when the fresh balance matches what was stored', () => {
    const [row] = compareBalances(item([plaidAccount('a')]), [localAccount('a')]);
    expect(row.delta).toBe(0);
    expect(row.missingLocally).toBe(false);
  });

  it('computes fresh minus stored', () => {
    const [row] = compareBalances(
      item([plaidAccount('a', { current: 250.25 })]),
      [localAccount('a', { balance: 100 })],
    );
    expect(row.delta).toBe(150.25);
  });

  it('rounds to cents so float noise does not read as drift', () => {
    const [row] = compareBalances(
      item([plaidAccount('a', { current: 0.3 })]),
      [localAccount('a', { balance: 0.1 + 0.2 })],
    );
    // Object.is(-0, 0) is false, and toBe uses it — asserting +0 is what keeps
    // "-0.00" from reappearing in the delta column.
    expect(row.delta).toBe(0);
    expect(Object.is(row.delta, -0)).toBe(false);
  });

  it('carries a negative delta through — spending since the snapshot', () => {
    const [row] = compareBalances(
      item([plaidAccount('a', { current: 80 })]),
      [localAccount('a', { balance: 100 })],
    );
    expect(row.delta).toBe(-20);
  });

  it('flags an account Plaid returned that the database has never seen', () => {
    const [row] = compareBalances(item([plaidAccount('new')]), []);
    expect(row.missingLocally).toBe(true);
    expect(row.stored).toBeNull();
    // No stored side means no meaningful delta — 100 would imply drift.
    expect(row.delta).toBeNull();
  });

  it('leaves the delta null when the account exists but was never snapshotted', () => {
    const [row] = compareBalances(
      item([plaidAccount('a')]),
      [localAccount('a', { balance: null, balance_date: null })],
    );
    expect(row.missingLocally).toBe(false);
    expect(row.delta).toBeNull();
    expect(row.storedDate).toBeNull();
  });

  it('keeps a null current balance null rather than coercing it to 0', () => {
    // Plaid returns null current for some investment and loan accounts.
    const [row] = compareBalances(
      item([plaidAccount('a', { current: null })]),
      [localAccount('a')],
    );
    expect(row.fresh).toBeNull();
    expect(row.delta).toBeNull();
  });

  it('surfaces available, limit, currency and the freshness stamp', () => {
    const [row] = compareBalances(
      item([plaidAccount('a', {
        current: 410, available: 1590, limit: 2000,
        iso_currency_code: 'USD', last_updated_datetime: '2026-08-17T09:00:00Z',
      })]),
      [localAccount('a')],
    );
    expect(row).toMatchObject({
      available: 1590, limit: 2000, currency: 'USD',
      lastUpdated: '2026-08-17T09:00:00Z',
    });
  });

  it('prefers the local nickname over the Plaid account name', () => {
    const [row] = compareBalances(
      item([plaidAccount('a', {}, { name: 'Plaid Checking' })]),
      [localAccount('a', { nickname: 'Bills Account' })],
    );
    expect(row.label).toBe('Bills Account ···0000');
  });

  it('skips items that failed, without dropping the ones that worked', () => {
    const rows = compareBalances(
      [
        { itemId: 'item-dead', institution: 'Wells', accounts: [], error: 'ITEM_LOGIN_REQUIRED' },
        { itemId: 'item-1', institution: 'Chase', accounts: [plaidAccount('a')] },
      ],
      [localAccount('a')],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].institution).toBe('Chase');
  });
});

describe('classifyUnfetched', () => {
  it('treats manual and CSV accounts as expected — they have no Plaid item', () => {
    const local = [
      localAccount('manual-house', { item_id: null }),
      localAccount('csv-acct-1234', { item_id: null }),
    ];
    const { expected, orphaned } = classifyUnfetched(local, new Set());
    expect(expected.map((a) => a.id)).toEqual(['manual-house', 'csv-acct-1234']);
    expect(orphaned).toEqual([]);
  });

  it('flags a Plaid-shaped account no live item returned as orphaned', () => {
    // What a relinked or removed item leaves behind: its balances can never
    // update again, but it still counts toward net worth.
    const { expected, orphaned } = classifyUnfetched([localAccount('abc123')], new Set());
    expect(orphaned.map((a) => a.id)).toEqual(['abc123']);
    expect(expected).toEqual([]);
  });

  it('leaves fetched accounts out of both lists', () => {
    const { expected, orphaned } = classifyUnfetched([localAccount('abc123')], new Set(['abc123']));
    expect(expected).toEqual([]);
    expect(orphaned).toEqual([]);
  });
});
