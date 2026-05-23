import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: makeTestDb() };
});

import { db } from '../core/db.js';
import { deduplicateCsvVsPlaid } from '../core/dedup.js';

let seq = 0;
const csvTx = (opts: { name: string; amount: number; date?: string; accountId?: string }) => {
  seq++;
  db.prepare(`
    INSERT INTO transactions (id, account_id, date, name, amount, pending, ignored)
    VALUES (?, ?, ?, ?, ?, 0, 0)
  `).run(
    `csv-${seq}`,
    opts.accountId ?? 'acct1',
    opts.date ?? '2025-01-15',
    opts.name,
    opts.amount,
  );
  return `csv-${seq}`;
};
const plaidTx = (opts: { name: string; amount: number; date?: string; accountId?: string }) => {
  seq++;
  db.prepare(`
    INSERT INTO transactions (id, account_id, date, name, amount, pending, ignored)
    VALUES (?, ?, ?, ?, ?, 0, 0)
  `).run(
    `plaid-${seq}`,
    opts.accountId ?? 'acct1',
    opts.date ?? '2025-01-15',
    opts.name,
    opts.amount,
  );
  return `plaid-${seq}`;
};
const exists = (id: string) =>
  !!(db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(id));

beforeEach(() => {
  seq = 0;
  db.exec('DELETE FROM transactions');
});

describe('deduplicateCsvVsPlaid', () => {
  it('returns 0 when no transactions', () => {
    expect(deduplicateCsvVsPlaid()).toBe(0);
  });

  it('returns 0 when only CSV transactions (no Plaid to match against)', () => {
    csvTx({ name: 'Amazon', amount: 50 });
    csvTx({ name: 'Starbucks', amount: 5 });
    expect(deduplicateCsvVsPlaid()).toBe(0);
  });

  it('returns 0 when only Plaid transactions', () => {
    plaidTx({ name: 'Amazon', amount: 50 });
    expect(deduplicateCsvVsPlaid()).toBe(0);
  });

  describe('name matching', () => {
    it('removes CSV on exact name match', () => {
      const csv = csvTx({ name: 'STARBUCKS', amount: 5 });
      plaidTx({ name: 'STARBUCKS', amount: 5 });
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });

    it('removes CSV when Plaid name is a substring of CSV name', () => {
      // CSV has a longer description, Plaid has the merchant name
      const csv = csvTx({ name: "Paper Payment to Albany Children's Center", amount: 200 });
      plaidTx({ name: "Albany Children's Center", amount: 200 });
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });

    it('removes CSV when CSV name is a substring of Plaid name', () => {
      const csv = csvTx({ name: 'WHOLE FOODS', amount: 87.50 });
      plaidTx({ name: 'WHOLE FOODS MARKET #123', amount: 87.50 });
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });

    it('handles Plaid masked names (MERCHANT* prefix)', () => {
      // Plaid: "WHOLE*0001", prefix = "WHOLE" (5 chars ≥ 4)
      // CSV: "WHOLEFDS" → SUBSTR(csv, 1, 5) = "WHOLE" = plaid prefix → match
      const csv = csvTx({ name: 'WHOLEFDS', amount: 87.50 });
      plaidTx({ name: 'WHOLE*0001', amount: 87.50 });
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });

    it('matches masked Plaid name when prefix clearly identifies merchant', () => {
      // Plaid: "COSTCO*WHSE", prefix before * = "COSTCO" (6 chars ≥4)
      // CSV: "COSTCO GAS #123"
      const csv = csvTx({ name: 'COSTCO GAS #123', amount: 75.00 });
      plaidTx({ name: 'COSTCO*WHSE 0001', amount: 75.00 });
      // prefix = 'COSTCO', csv starts with 'COSTCO' → match
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });

    it('does not match when names are completely different', () => {
      csvTx({ name: 'STARBUCKS', amount: 5 });
      plaidTx({ name: 'AMAZON', amount: 5 });
      expect(deduplicateCsvVsPlaid()).toBe(0);
    });
  });

  describe('amount matching', () => {
    it('does not deduplicate when amounts differ', () => {
      csvTx({ name: 'STARBUCKS', amount: 5.00 });
      plaidTx({ name: 'STARBUCKS', amount: 5.50 }); // different amount
      expect(deduplicateCsvVsPlaid()).toBe(0);
    });

    it('deduplicates when amounts match exactly', () => {
      const csv = csvTx({ name: 'AMAZON', amount: 29.99 });
      plaidTx({ name: 'AMAZON', amount: 29.99 });
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });
  });

  describe('date matching', () => {
    it('deduplicates when dates match exactly', () => {
      const csv = csvTx({ name: 'AMAZON', amount: 50, date: '2025-01-15' });
      plaidTx({ name: 'AMAZON', amount: 50, date: '2025-01-15' });
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });

    it('deduplicates when dates are within 3 days', () => {
      const csv = csvTx({ name: 'AMAZON', amount: 50, date: '2025-01-15' });
      plaidTx({ name: 'AMAZON', amount: 50, date: '2025-01-18' }); // 3 days later
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });

    it('does not deduplicate when date difference exceeds 3 days', () => {
      csvTx({ name: 'AMAZON', amount: 50, date: '2025-01-15' });
      plaidTx({ name: 'AMAZON', amount: 50, date: '2025-01-19' }); // 4 days later
      expect(deduplicateCsvVsPlaid()).toBe(0);
    });
  });

  describe('account matching', () => {
    it('does not deduplicate when accounts differ', () => {
      csvTx({ name: 'AMAZON', amount: 50, accountId: 'acct1' });
      plaidTx({ name: 'AMAZON', amount: 50, accountId: 'acct2' }); // different account
      expect(deduplicateCsvVsPlaid()).toBe(0);
    });

    it('deduplicates when accounts match', () => {
      const csv = csvTx({ name: 'AMAZON', amount: 50, accountId: 'chase' });
      plaidTx({ name: 'AMAZON', amount: 50, accountId: 'chase' });
      expect(deduplicateCsvVsPlaid()).toBe(1);
      expect(exists(csv)).toBe(false);
    });
  });

  describe('ID prefix enforcement', () => {
    it('only removes csv- prefixed transactions, never Plaid', () => {
      const plaid = plaidTx({ name: 'AMAZON', amount: 50 });
      csvTx({ name: 'AMAZON', amount: 50 });
      deduplicateCsvVsPlaid();
      // Plaid transaction must survive
      expect(exists(plaid)).toBe(true);
    });

    it('handles multiple CSV duplicates of the same Plaid transaction', () => {
      const csv1 = csvTx({ name: 'STARBUCKS', amount: 5 });
      const csv2 = csvTx({ name: 'STARBUCKS', amount: 5 });
      plaidTx({ name: 'STARBUCKS', amount: 5 });
      const removed = deduplicateCsvVsPlaid();
      // Both CSVs match the single Plaid tx
      expect(removed).toBe(2);
      expect(exists(csv1)).toBe(false);
      expect(exists(csv2)).toBe(false);
    });
  });

  it('returns count of removed transactions', () => {
    csvTx({ name: 'AMAZON', amount: 10 });
    csvTx({ name: 'NETFLIX', amount: 15 });
    csvTx({ name: 'STARBUCKS', amount: 5 });
    plaidTx({ name: 'AMAZON', amount: 10 });
    plaidTx({ name: 'NETFLIX', amount: 15 });
    // Starbucks has no Plaid match
    expect(deduplicateCsvVsPlaid()).toBe(2);
  });
});
