import { db } from './db.js';
import { categorizeWithRules, loadCategoryRules } from './categorize.js';
import { rebuildDisplayNames } from './rename.js';
import { applyTagRules, type TagMatchType } from './tag-rules.js';

async function applyAll(): Promise<number> {
  const rules = await loadCategoryRules();
  const txRes = await db.execute(
    'SELECT id, account_id, name, merchant_name, raw_category, amount, category FROM transactions WHERE manual_category IS NULL'
  );
  const rows = txRes.rows as unknown as {
    id: string; account_id: string; name: string; merchant_name: string | null;
    raw_category: string | null; amount: number; category: string;
  }[];

  const updates: { sql: string; args: (string | number | null)[] }[] = [];
  for (const tx of rows) {
    const cat = categorizeWithRules(rules, tx.name, tx.merchant_name, tx.raw_category, tx.amount, tx.account_id);
    if (cat !== tx.category) {
      updates.push({ sql: 'UPDATE transactions SET category = ? WHERE id = ?', args: [cat, tx.id] });
    }
  }
  if (updates.length > 0) await db.batch(updates, 'write');
  return updates.length;
}

export async function getUncategorizedCount(): Promise<number> {
  const result = await db.execute("SELECT COUNT(*) as c FROM transactions WHERE category = 'Uncategorized'");
  return Number((result.rows[0] as unknown as { c: number }).c);
}

export async function deleteCategoryRule(id: number): Promise<number> {
  await db.execute({ sql: 'DELETE FROM category_rules WHERE id = ?', args: [id] });
  return applyAll();
}

export async function deleteNameRule(id: number): Promise<void> {
  await db.execute({ sql: 'DELETE FROM name_rules WHERE id = ?', args: [id] });
  await rebuildDisplayNames();
}

export type SaveCategoryRuleOpts = {
  pattern: string;
  matchType: 'name' | 'regex';
  category: string;
  minAmount: number | null;
  maxAmount: number | null;
  accountId?: string | null;
  editingId?: number | null;
};

export async function saveCategoryRule(opts: SaveCategoryRuleOpts): Promise<number> {
  const { pattern, matchType, category, minAmount, maxAmount, accountId = null, editingId } = opts;
  if (editingId != null) {
    await db.execute({
      sql: 'UPDATE category_rules SET match_type = ?, pattern = ?, category = ?, min_amount = ?, max_amount = ?, account_id = ? WHERE id = ?',
      args: [matchType, pattern, category, minAmount, maxAmount, accountId, editingId],
    });
  } else {
    const existing = await db.execute({
      sql: 'SELECT id FROM category_rules WHERE match_type = ? AND pattern = ? AND account_id IS ?',
      args: [matchType, pattern, accountId],
    });
    if (existing.rows.length > 0) {
      const id = (existing.rows[0] as unknown as { id: number }).id;
      await db.execute({
        sql: 'UPDATE category_rules SET category = ?, min_amount = ?, max_amount = ? WHERE id = ?',
        args: [category, minAmount, maxAmount, id],
      });
    } else {
      await db.execute({
        sql: 'INSERT INTO category_rules (priority, match_type, pattern, category, min_amount, max_amount, account_id) VALUES (10, ?, ?, ?, ?, ?, ?)',
        args: [matchType, pattern, category, minAmount, maxAmount, accountId],
      });
    }
  }
  return applyAll();
}

export type SaveNameRuleOpts = {
  pattern: string;
  matchType: 'name' | 'regex';
  replacement: string;
  minAmount: number | null;
  maxAmount: number | null;
  accountId?: string | null;
  editingId?: number | null;
};

export async function saveNameRule(opts: SaveNameRuleOpts): Promise<void> {
  const { pattern, matchType, replacement, minAmount, maxAmount, accountId = null, editingId } = opts;
  if (editingId != null) {
    await db.execute({
      sql: 'UPDATE name_rules SET match_type = ?, pattern = ?, replacement = ?, min_amount = ?, max_amount = ?, account_id = ? WHERE id = ?',
      args: [matchType, pattern, replacement, minAmount, maxAmount, accountId, editingId],
    });
  } else {
    await db.execute({
      sql: 'INSERT INTO name_rules (match_type, pattern, replacement, min_amount, max_amount, account_id) VALUES (?, ?, ?, ?, ?, ?)',
      args: [matchType, pattern, replacement, minAmount, maxAmount, accountId],
    });
  }
  await rebuildDisplayNames();
}

export async function deleteTagRule(id: number): Promise<void> {
  // Leaves already-applied tags in place (mirrors category-rule delete).
  await db.execute({ sql: 'DELETE FROM tag_rules WHERE id = ?', args: [id] });
}

export type SaveTagRuleOpts = {
  matchType: TagMatchType;
  pattern: string;
  tagId: number;
  minAmount: number | null;
  maxAmount: number | null;
  accountId?: string | null;
  editingId?: number | null;
};

export async function saveTagRule(opts: SaveTagRuleOpts): Promise<number> {
  const { matchType, pattern, tagId, minAmount, maxAmount, accountId = null, editingId } = opts;
  const normPattern = matchType === 'all' ? '' : pattern;
  if (editingId != null) {
    await db.execute({
      sql: 'UPDATE tag_rules SET match_type = ?, pattern = ?, tag_id = ?, min_amount = ?, max_amount = ?, account_id = ? WHERE id = ?',
      args: [matchType, normPattern, tagId, minAmount, maxAmount, accountId, editingId],
    });
  } else {
    const existing = await db.execute({
      sql: 'SELECT id FROM tag_rules WHERE match_type = ? AND pattern = ? AND account_id IS ? AND tag_id = ?',
      args: [matchType, normPattern, accountId, tagId],
    });
    if (existing.rows.length > 0) {
      const id = (existing.rows[0] as unknown as { id: number }).id;
      await db.execute({
        sql: 'UPDATE tag_rules SET min_amount = ?, max_amount = ? WHERE id = ?',
        args: [minAmount, maxAmount, id],
      });
    } else {
      await db.execute({
        sql: 'INSERT INTO tag_rules (priority, match_type, pattern, tag_id, min_amount, max_amount, account_id) VALUES (10, ?, ?, ?, ?, ?, ?)',
        args: [matchType, normPattern, tagId, minAmount, maxAmount, accountId],
      });
    }
  }
  return applyTagRules();
}

export async function setCategoryFlexibility(name: string, flexibility: string | null): Promise<void> {
  await db.execute({ sql: 'UPDATE categories SET flexibility = ? WHERE name = ?', args: [flexibility, name] });
}

export async function createCategory(name: string): Promise<void> {
  await db.execute({ sql: 'INSERT OR IGNORE INTO categories (name) VALUES (?)', args: [name] });
}

export async function deleteCategory(name: string): Promise<void> {
  await db.batch([
    { sql: "UPDATE transactions SET category = 'Uncategorized', manual_category = NULL WHERE category = ?", args: [name] },
    { sql: 'DELETE FROM hidden_categories WHERE category = ?', args: [name] },
    { sql: 'DELETE FROM categories WHERE name = ?', args: [name] },
  ], 'write');
}

export async function renameCategory(oldName: string, newName: string): Promise<void> {
  await db.batch([
    { sql: 'INSERT OR IGNORE INTO categories (name, flexibility) SELECT ?, flexibility FROM categories WHERE name = ?', args: [newName, oldName] },
    { sql: 'UPDATE transactions SET category = ? WHERE category = ?', args: [newName, oldName] },
    { sql: 'UPDATE transactions SET manual_category = ? WHERE manual_category = ?', args: [newName, oldName] },
    { sql: 'UPDATE category_rules SET category = ? WHERE category = ?', args: [newName, oldName] },
    { sql: 'UPDATE hidden_categories SET category = ? WHERE category = ?', args: [newName, oldName] },
    { sql: 'DELETE FROM categories WHERE name = ?', args: [oldName] },
  ], 'write');
}
