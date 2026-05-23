import { db } from './db.js';

type NameRule = {
  match_type: 'name' | 'regex';
  pattern: string;
  replacement: string;
};

/** Returns the display name for a transaction, applying name_rules in order. */
export function applyNameRules(name: string): string {
  const rules = db.prepare(
    'SELECT match_type, pattern, replacement FROM name_rules ORDER BY id ASC'
  ).all() as NameRule[];

  for (const rule of rules) {
    if (rule.match_type === 'name') {
      if (name.toLowerCase().includes(rule.pattern.toLowerCase())) {
        return rule.replacement;
      }
    } else {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(name)) {
        return rule.replacement;
      }
    }
  }

  return name;
}

/** Re-apply all name rules to every transaction and update display_name. */
export function rebuildDisplayNames() {
  const rows = db.prepare(
    'SELECT id, name FROM transactions'
  ).all() as { id: string; name: string }[];

  const update = db.prepare('UPDATE transactions SET display_name = ? WHERE id = ?');
  for (const tx of rows) {
    const display = applyNameRules(tx.name);
    update.run(display !== tx.name ? display : null, tx.id);
  }
  return rows.length;
}
