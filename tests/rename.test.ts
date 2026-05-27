import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: makeTestDb() };
});

import { db } from '../core/db.js';
import { applyNameRules, rebuildDisplayNames } from '../core/rename.js';

const insertRule = db.prepare(
  'INSERT INTO name_rules (match_type, pattern, replacement, min_amount, max_amount) VALUES (?, ?, ?, ?, ?)'
);

beforeEach(() => {
  db.exec('DELETE FROM name_rules');
  db.exec('DELETE FROM transactions');
});

describe('applyNameRules', () => {
  it('returns original name when no rules exist', () => {
    expect(applyNameRules('STARBUCKS #12345')).toBe('STARBUCKS #12345');
    expect(applyNameRules('AMZN*MKTP US')).toBe('AMZN*MKTP US');
  });

  describe('name match', () => {
    it('replaces when name contains pattern (case-insensitive)', () => {
      insertRule.run('name', 'starbucks', 'Starbucks', null, null);
      expect(applyNameRules('STARBUCKS #12345')).toBe('Starbucks');
      expect(applyNameRules('Starbucks Coffee')).toBe('Starbucks');
      expect(applyNameRules('starbucks downtown')).toBe('Starbucks');
    });

    it('does not match when pattern not in name', () => {
      insertRule.run('name', 'starbucks', 'Starbucks', null, null);
      expect(applyNameRules('COFFEE BEAN')).toBe('COFFEE BEAN');
    });
  });

  describe('regex match', () => {
    it('replaces on regex match', () => {
      insertRule.run('regex', '^AMZN\\*', 'Amazon', null, null);
      expect(applyNameRules('AMZN*MKTP US')).toBe('Amazon');
      expect(applyNameRules('AMZN*DIGITAL')).toBe('Amazon');
    });

    it('does not replace when regex does not match', () => {
      insertRule.run('regex', '^AMZN\\*', 'Amazon', null, null);
      expect(applyNameRules('AMAZON MARKETPLACE')).toBe('AMAZON MARKETPLACE');
    });

    it('is case-insensitive', () => {
      insertRule.run('regex', 'netflix', 'Netflix', null, null);
      expect(applyNameRules('NETFLIX.COM')).toBe('Netflix');
      expect(applyNameRules('netflix monthly')).toBe('Netflix');
    });
  });

  describe('rule ordering', () => {
    it('first matching rule wins (ordered by id ASC)', () => {
      insertRule.run('name', 'venmo', 'Venmo Transfer', null, null);
      insertRule.run('name', 'venmo', 'Phone Bill', null, null);
      expect(applyNameRules('VENMO PAYMENT')).toBe('Venmo Transfer');
    });

    it('falls through to next rule when first does not match', () => {
      insertRule.run('name', 'zelle', 'Zelle', null, null);
      insertRule.run('name', 'venmo', 'Venmo', null, null);
      expect(applyNameRules('VENMO PAYMENT')).toBe('Venmo');
    });
  });

  describe('amount filtering', () => {
    it('skips rule when amount is below min_amount', () => {
      insertRule.run('name', 'venmo', 'Phone Bill', 54.79, 54.79);
      expect(applyNameRules('VENMO PAYMENT', 10.00)).toBe('VENMO PAYMENT');
    });

    it('skips rule when amount is above max_amount', () => {
      insertRule.run('name', 'venmo', 'Phone Bill', 54.79, 54.79);
      expect(applyNameRules('VENMO PAYMENT', 100.00)).toBe('VENMO PAYMENT');
    });

    it('applies rule when amount is exactly at min_amount (= max_amount)', () => {
      insertRule.run('name', 'venmo', 'Phone Bill', 54.79, 54.79);
      expect(applyNameRules('VENMO PAYMENT', 54.79)).toBe('Phone Bill');
    });

    it('applies rule when no amount provided (amount filter skipped)', () => {
      insertRule.run('name', 'venmo', 'Phone Bill', 54.79, 54.79);
      expect(applyNameRules('VENMO PAYMENT')).toBe('Phone Bill');
    });

    it('applies rule when amount is in a range', () => {
      insertRule.run('name', 'check', 'Large Check', 1000, null);
      expect(applyNameRules('CHECK #5678', 500)).toBe('CHECK #5678');
      expect(applyNameRules('CHECK #5678', 1000)).toBe('Large Check');
      expect(applyNameRules('CHECK #5678', 5000)).toBe('Large Check');
    });

    it('falls through to next rule when amount out of range', () => {
      insertRule.run('name', 'venmo', 'Phone Bill', 54.79, 54.79);
      insertRule.run('name', 'venmo', 'Venmo', null, null);
      expect(applyNameRules('VENMO PAYMENT', 100.00)).toBe('Venmo');
      expect(applyNameRules('VENMO PAYMENT', 54.79)).toBe('Phone Bill');
    });
  });
});

describe('rebuildDisplayNames', () => {
  const insertTx = (id: string, name: string, amount: number) => {
    db.prepare(
      "INSERT INTO transactions (id, account_id, date, name, amount) VALUES (?, 'acct1', '2025-01-01', ?, ?)"
    ).run(id, name, amount);
  };

  it('returns the count of changed transactions', () => {
    insertRule.run('name', 'starbucks', 'Starbucks', null, null);
    insertTx('tx1', 'STARBUCKS #1', 5.00);
    insertTx('tx2', 'NETFLIX.COM', 15.99);
    expect(rebuildDisplayNames()).toBe(1); // only tx1 matches the rule
  });

  it('sets display_name for matching transactions', () => {
    insertRule.run('name', 'starbucks', 'Starbucks', null, null);
    insertTx('tx1', 'STARBUCKS #1234', 5.00);
    rebuildDisplayNames();
    const row = db.prepare('SELECT display_name FROM transactions WHERE id = ?').get('tx1') as any;
    expect(row.display_name).toBe('Starbucks');
  });

  it('sets display_name to null when name is unchanged', () => {
    insertTx('tx1', 'SOME RANDOM STORE', 20.00);
    rebuildDisplayNames();
    const row = db.prepare('SELECT display_name FROM transactions WHERE id = ?').get('tx1') as any;
    expect(row.display_name).toBeNull();
  });

  it('respects amount filtering when rebuilding', () => {
    insertRule.run('name', 'venmo', 'Phone Bill', 54.79, 54.79);
    insertTx('tx1', 'VENMO PAYMENT', 54.79); // matches amount
    insertTx('tx2', 'VENMO PAYMENT', 200.00); // does not match amount
    rebuildDisplayNames();
    const tx1 = db.prepare('SELECT display_name FROM transactions WHERE id = ?').get('tx1') as any;
    const tx2 = db.prepare('SELECT display_name FROM transactions WHERE id = ?').get('tx2') as any;
    expect(tx1.display_name).toBe('Phone Bill');
    expect(tx2.display_name).toBeNull();
  });

  it('returns 0 when no display names change', () => {
    insertTx('tx1', 'COFFEE SHOP', 3.50);
    insertTx('tx2', 'GAS STATION', 60.00);
    const count = rebuildDisplayNames();
    expect(count).toBe(0);
    const tx1 = db.prepare('SELECT display_name FROM transactions WHERE id = ?').get('tx1') as any;
    expect(tx1.display_name).toBeNull();
  });
});
