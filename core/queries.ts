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

export function getUncategorizedCount(from: string, to: string, accountId?: string): number {
  const where = accountId ? 'AND account_id = ?' : '';
  const args = accountId ? [from, to, accountId] : [from, to];
  return (db.prepare(`
    SELECT COUNT(*) as c FROM transactions
    WHERE category = 'Uncategorized' AND pending = 0 AND ignored = 0
      AND date >= ? AND date <= ? ${where}
  `).get(...args) as { c: number }).c;
}

export function getDataBounds(): { minDate: string; maxDate: string } {
  const row = db.prepare(`
    SELECT MIN(date) as minDate, MAX(date) as maxDate
    FROM transactions WHERE pending = 0 AND ignored = 0
  `).get() as { minDate: string | null; maxDate: string | null } | null;
  return {
    minDate: row?.minDate ?? '2000-01-01',
    maxDate: row?.maxDate ?? '2099-12-31',
  };
}

export type AccountRow = { id: string; name: string; subtype: string | null; spending: number; income: number };

export function getAccountRows(from: string, to: string): AccountRow[] {
  return db.prepare(`
    SELECT a.id, a.name, a.subtype,
      COALESCE(SUM(CASE WHEN t.amount > 0 AND t.date >= ? AND t.date <= ?
                        AND t.pending = 0 AND t.ignored = 0
                        AND t.category != 'Transfer' THEN t.amount ELSE 0 END), 0) as spending,
      COALESCE(-SUM(CASE WHEN t.amount < 0 AND t.date >= ? AND t.date <= ?
                         AND t.pending = 0 AND t.ignored = 0
                         AND t.category != 'Transfer' THEN t.amount ELSE 0 END), 0) as income
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY a.id, a.name, a.subtype
    ORDER BY CASE a.type WHEN 'depository' THEN 0 WHEN 'investment' THEN 1 ELSE 2 END, spending DESC
  `).all(from, to, from, to) as AccountRow[];
}

export type OwnerRow = { owner: string; spending: number };

export function getOwnerRows(from: string, to: string): OwnerRow[] {
  return db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(a.owner), ''), 'Unassigned') as owner,
      COALESCE(SUM(CASE WHEN t.amount > 0 AND t.date >= ? AND t.date <= ?
                        AND t.pending = 0 AND t.ignored = 0
                        AND t.category NOT IN (SELECT category FROM hidden_categories)
                        THEN t.amount ELSE 0 END), 0) as spending
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
    GROUP BY owner
    ORDER BY spending DESC
  `).all(from, to) as OwnerRow[];
}

export type Rule = { id: number; priority: number; match_type: string; pattern: string; category: string; min_amount: number | null; max_amount: number | null };
export type NameRule = { id: number; match_type: string; pattern: string; replacement: string; min_amount: number | null; max_amount: number | null };
export type CategoryDetail = { name: string; flexibility: 'fixed' | 'flexible' | 'discretionary' | null };

export function getAllRules(): Rule[] {
  return db.prepare('SELECT id, priority, match_type, pattern, category, min_amount, max_amount FROM category_rules ORDER BY priority DESC, id ASC').all() as Rule[];
}

export function getAllNameRules(): NameRule[] {
  return db.prepare('SELECT id, match_type, pattern, replacement, min_amount, max_amount FROM name_rules ORDER BY id ASC').all() as NameRule[];
}

export function getAllCategories(): string[] {
  return (db.prepare('SELECT name FROM categories ORDER BY name').all() as { name: string }[]).map((r) => r.name);
}

export function getCategoryDetails(): CategoryDetail[] {
  return db.prepare('SELECT name, flexibility FROM categories ORDER BY name').all() as CategoryDetail[];
}

export function getHiddenCategorySet(): Set<string> {
  const rows = db.prepare('SELECT category FROM hidden_categories').all() as { category: string }[];
  return new Set(rows.map((r) => r.category));
}

export function toggleHiddenCategory(category: string, hidden: Set<string>): void {
  if (hidden.has(category)) {
    db.prepare('DELETE FROM hidden_categories WHERE category = ?').run(category);
  } else {
    db.prepare('INSERT OR IGNORE INTO hidden_categories (category) VALUES (?)').run(category);
  }
}

export type Tag = { id: number; name: string; count: number };

export function getAllTags(): Tag[] {
  return db.prepare(`
    SELECT t.id, t.name, COUNT(tt.transaction_id) as count
    FROM tags t
    LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `).all() as Tag[];
}

export type SortMode = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc' | 'name-asc' | 'name-desc' | 'category-asc' | 'category-desc';

export const SORT_ORDER_BY: Record<SortMode, string> = {
  'date-desc':     't.date DESC, t.id DESC',
  'date-asc':      't.date ASC, t.id ASC',
  'amount-desc':   't.amount DESC',
  'amount-asc':    't.amount ASC',
  'name-asc':      'COALESCE(t.display_name, t.name) ASC',
  'name-desc':     'COALESCE(t.display_name, t.name) DESC',
  'category-asc':  't.category ASC, t.date DESC',
  'category-desc': 't.category DESC, t.date DESC',
};

export type TxRow = {
  id: string;
  date: string;
  name: string;
  display_name: string | null;
  merchant_name: string | null;
  amount: number;
  category: string;
  manual_category: string | null;
  ignored: number;
  tag_names: string | null;
};

export function getTransactions(filters: {
  category?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string;
  tag?: string | null;
  account?: string | null;
  sort?: SortMode;
}): TxRow[] {
  const { category, from, to, search, tag, account, sort = 'date-desc' } = filters;
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (category) { conditions.push('t.category = ?'); args.push(category); }
  if (from && to) {
    conditions.push('t.date >= ? AND t.date <= ?');
    args.push(from, to);
  }
  if (search) {
    conditions.push('(t.name LIKE ? OR t.display_name LIKE ? OR t.merchant_name LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (tag) {
    conditions.push('EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = t.id AND tg.name = ?)');
    args.push(tag);
  }
  if (account) { conditions.push('t.account_id = ?'); args.push(account); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return db.prepare(`
    SELECT t.id, t.date, t.name, t.display_name, t.merchant_name, t.amount, t.category, t.manual_category, t.ignored,
      (SELECT GROUP_CONCAT(tg2.name, ', ') FROM transaction_tags tt2 JOIN tags tg2 ON tg2.id = tt2.tag_id WHERE tt2.transaction_id = t.id) as tag_names
    FROM transactions t
    ${where}
    ORDER BY ${SORT_ORDER_BY[sort]}
    LIMIT 200
  `).all(...args) as TxRow[];
}

export type LinkedAccount = {
  id: string;
  name: string;
  nickname: string | null;
  owner: string | null;
  default_tag: string | null;
  type: string;
  subtype: string | null;
  institution_name: string | null;
  mask: string | null;
  last_synced: string | null;
  item_id: string | null;
};

export function getLinkedAccounts(): LinkedAccount[] {
  return db.prepare(`
    SELECT a.id, a.name, a.nickname, a.owner, a.default_tag, a.type, a.subtype, a.institution_name, a.mask, a.item_id,
      (SELECT MAX(date) FROM balance_history WHERE account_id = a.id) as last_synced
    FROM accounts a
    ORDER BY
      CASE a.type WHEN 'depository' THEN 0 WHEN 'investment' THEN 1 WHEN 'credit' THEN 2 ELSE 3 END,
      a.name
  `).all() as LinkedAccount[];
}

export type PlaidLink = {
  item_id: string;
  institution_name: string | null;
  last_synced_at: number | null;
  account_count: number;
};

export function getPlaidLinks(): PlaidLink[] {
  return db.prepare(`
    SELECT p.item_id, p.institution_name, p.last_synced_at,
      (SELECT COUNT(*) FROM accounts a WHERE a.item_id = p.item_id) as account_count
    FROM plaid_items p
    ORDER BY p.institution_name, p.item_id
  `).all() as PlaidLink[];
}

export type CsvAccount = { id: string; name: string; mask: string | null };

export function getCsvAccounts(): CsvAccount[] {
  return db.prepare('SELECT id, name, mask FROM accounts').all() as CsvAccount[];
}

export type AccountBalance = {
  name: string;
  nickname: string | null;
  type: string;
  subtype: string | null;
  balance: number;
};

export type HistoryRow = {
  date: string;
  assets: number;
  liabilities: number;
  net: number;
};

export function getAccountsWithBalances(): { accounts: AccountBalance[]; history: HistoryRow[] } {
  const accounts = db.prepare(`
    SELECT a.name, a.nickname, a.type, a.subtype, bh.balance
    FROM accounts a
    JOIN balance_history bh ON bh.account_id = a.id
    WHERE bh.date = (SELECT MAX(date) FROM balance_history WHERE account_id = a.id)
    ORDER BY
      CASE a.type WHEN 'depository' THEN 0 WHEN 'investment' THEN 1 ELSE 2 END,
      bh.balance DESC
  `).all() as AccountBalance[];

  const history = (db.prepare(`
    SELECT bh.date,
      SUM(CASE WHEN a.type IN ('depository','investment') OR (a.type = 'other' AND bh.balance > 0) THEN bh.balance ELSE 0 END) as assets,
      SUM(CASE WHEN a.type = 'credit' THEN bh.balance ELSE 0 END) as liabilities
    FROM balance_history bh
    JOIN accounts a ON a.id = bh.account_id
    GROUP BY bh.date
    ORDER BY bh.date
  `).all() as { date: string; assets: number; liabilities: number }[]).map((r) => ({
    ...r,
    net: r.assets - r.liabilities,
  }));

  return { accounts, history };
}
