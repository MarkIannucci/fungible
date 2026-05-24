import { db } from './db.js';
import { inAmountRange, matchesPattern } from './rule-utils.js';

type NameRule = {
  match_type: 'name' | 'regex';
  pattern: string;
  replacement: string;
  min_amount: number | null;
  max_amount: number | null;
};

/** Returns the display name for a transaction, applying name_rules in order. */
export function applyNameRules(name: string, amount?: number): string {
  const rules = db.prepare(
    'SELECT match_type, pattern, replacement, min_amount, max_amount FROM name_rules ORDER BY id ASC'
  ).all() as NameRule[];

  for (const rule of rules) {
    if (!inAmountRange(amount, rule.min_amount, rule.max_amount)) continue;
    if (matchesPattern(rule.pattern, rule.match_type, [name.toLowerCase()])) return rule.replacement;
  }

  return name;
}

/** Re-apply all name rules to every transaction and update display_name. */
export function rebuildDisplayNames() {
  const rows = db.prepare(
    'SELECT id, name, amount FROM transactions'
  ).all() as { id: string; name: string; amount: number }[];

  const update = db.prepare('UPDATE transactions SET display_name = ? WHERE id = ?');
  for (const tx of rows) {
    const display = applyNameRules(tx.name, tx.amount);
    update.run(display !== tx.name ? display : null, tx.id);
  }
  return rows.length;
}
