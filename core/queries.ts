import { db } from './db.js';

export type CategorySummary = {
  category: string;
  total: number;
};

export type MonthlySummary = {
  income: number;
  expenses: number;
  net: number;
  byCategory: CategorySummary[];
};

export type RecentTransaction = {
  id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  category: string;
};

export function getHiddenCategories(): Set<string> {
  const rows = db.prepare('SELECT category FROM hidden_categories').all() as { category: string }[];
  return new Set(rows.map((r) => r.category));
}

export function getMonthlySummary(year: number, month: number): MonthlySummary {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-31`;

  const rows = db.prepare(`
    SELECT category, SUM(amount) as total
    FROM transactions
    WHERE date >= ? AND date <= ? AND pending = 0 AND ignored = 0
      AND category NOT IN (SELECT category FROM hidden_categories)
    GROUP BY category
    ORDER BY total DESC
  `).all(from, to) as { category: string; total: number }[];

  // Plaid: positive = money out, negative = money in
  const income = rows
    .filter((r) => r.total < 0)
    .reduce((sum, r) => sum + Math.abs(r.total), 0);

  const expenses = rows
    .filter((r) => r.total > 0)
    .reduce((sum, r) => sum + r.total, 0);

  const byCategory = rows
    .filter((r) => r.total > 0)
    .map((r) => ({ category: r.category, total: r.total }));

  return { income, expenses, net: income - expenses, byCategory };
}

export function getRecentTransactions(limit = 10): RecentTransaction[] {
  return db.prepare(`
    SELECT id, date, name, merchant_name, amount, category
    FROM transactions
    WHERE pending = 0
    ORDER BY date DESC
    LIMIT ?
  `).all(limit) as RecentTransaction[];
}

export function hasAccounts(): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM plaid_items').get() as { count: number };
  return row.count > 0;
}
