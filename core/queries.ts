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
  return getRangeSummary(from, to);
}

export function getRangeSummary(from: string, to: string): MonthlySummary {
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

export function getTagSummary(tagName: string): MonthlySummary {
  const rows = db.prepare(`
    SELECT t.category, SUM(t.amount) as total
    FROM transactions t
    JOIN transaction_tags tt ON tt.transaction_id = t.id
    JOIN tags tg ON tg.id = tt.tag_id
    WHERE tg.name = ? AND t.ignored = 0
      AND t.category NOT IN (SELECT category FROM hidden_categories)
    GROUP BY t.category
    ORDER BY total DESC
  `).all(tagName) as { category: string; total: number }[];

  const income = rows.filter((r) => r.total < 0).reduce((s, r) => s + Math.abs(r.total), 0);
  const expenses = rows.filter((r) => r.total > 0).reduce((s, r) => s + r.total, 0);
  const byCategory = rows.filter((r) => r.total > 0).map((r) => ({ category: r.category, total: r.total }));

  return { income, expenses, net: income - expenses, byCategory };
}

export type FlexSummary = {
  fixed: number;
  flexible: number;
  discretionary: number;
  untagged: number;
};

export function getFlexSummary(from: string, to: string): FlexSummary {
  // Group by category first (matching getRangeSummary), then bucket by flexibility tier.
  // This ensures fixed + flexible + discretionary + untagged == totalExpenses.
  const rows = db.prepare(`
    SELECT COALESCE(c.flexibility, 'untagged') as tier, SUM(cat_totals.total) as total
    FROM (
      SELECT t.category, SUM(t.amount) as total
      FROM transactions t
      WHERE t.date >= ? AND t.date <= ? AND t.pending = 0 AND t.ignored = 0
        AND t.category NOT IN (SELECT category FROM hidden_categories)
      GROUP BY t.category
      HAVING SUM(t.amount) > 0
    ) as cat_totals
    LEFT JOIN categories c ON c.name = cat_totals.category
    GROUP BY tier
  `).all(from, to) as { tier: string; total: number }[];

  const result: FlexSummary = { fixed: 0, flexible: 0, discretionary: 0, untagged: 0 };
  for (const r of rows) {
    if (r.tier === 'fixed') result.fixed = r.total;
    else if (r.tier === 'flexible') result.flexible = r.total;
    else if (r.tier === 'discretionary') result.discretionary = r.total;
    else result.untagged = r.total;
  }
  return result;
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
