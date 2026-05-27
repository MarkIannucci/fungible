import { db } from './db.js';

export type SetDefaultTagResult = {
  oldTag: string | null;
  newTag: string | null;
  removed: number;
  tagged: number;
  created: boolean;
};

/** Returns whether a tag with the given name already exists. */
export function tagExists(name: string): boolean {
  return !!db.prepare('SELECT 1 FROM tags WHERE name = ?').get(name.trim());
}

/**
 * Sets (or clears, when newName is null/empty) an account's default tag.
 * Strips the previous default tag from the account's transactions by name,
 * then applies the new tag to all of the account's transactions, creating
 * the tag if it doesn't exist. Returns counts so the caller can report them.
 */
export function setAccountDefaultTag(accountId: string, newName: string | null): SetDefaultTagResult {
  const trimmed = newName?.trim() || null;
  const acct = db.prepare('SELECT default_tag FROM accounts WHERE id = ?').get(accountId) as
    | { default_tag: string | null }
    | undefined;
  const oldTag = acct?.default_tag ?? null;

  let removed = 0;
  let tagged = 0;
  let created = false;

  // Remove the previous default tag from this account's transactions when it changes or clears.
  if (oldTag && oldTag !== trimmed) {
    const old = db.prepare('SELECT id FROM tags WHERE name = ?').get(oldTag) as { id: number } | undefined;
    if (old) {
      removed = (db.prepare(`
        DELETE FROM transaction_tags
        WHERE tag_id = ? AND transaction_id IN (SELECT id FROM transactions WHERE account_id = ?)
      `).run(old.id, accountId) as { changes: number }).changes;
    }
  }

  db.prepare('UPDATE accounts SET default_tag = ? WHERE id = ?').run(trimmed, accountId);

  if (trimmed) {
    if (!tagExists(trimmed)) {
      db.prepare('INSERT INTO tags (name) VALUES (?)').run(trimmed);
      created = true;
    }
    tagged = applyDefaultTagToAccount(accountId);
  }

  return { oldTag, newTag: trimmed, removed, tagged, created };
}

/**
 * Applies the account's current default tag to all of its transactions (idempotent).
 * Used both interactively and from the sync / CSV-import paths so newly arrived
 * transactions inherit the tag. Returns the number of the account's transactions.
 */
export function applyDefaultTagToAccount(accountId: string): number {
  const acct = db.prepare('SELECT default_tag FROM accounts WHERE id = ?').get(accountId) as
    | { default_tag: string | null }
    | undefined;
  const name = acct?.default_tag?.trim();
  if (!name) return 0;

  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
  const tagId = (db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }).id;
  db.prepare(`
    INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
    SELECT id, ? FROM transactions WHERE account_id = ?
  `).run(tagId, accountId);

  return (db.prepare('SELECT COUNT(*) as c FROM transactions WHERE account_id = ?').get(accountId) as { c: number }).c;
}

/**
 * Keeps account default-tag references in sync when a tag is renamed.
 * The tag's id is unchanged, so transaction links stay valid; only the
 * name stored on accounts.default_tag needs updating. Returns affected count.
 */
export function renameDefaultTagReferences(oldName: string, newName: string): number {
  return (db.prepare('UPDATE accounts SET default_tag = ? WHERE default_tag = ?')
    .run(newName, oldName) as { changes: number }).changes;
}

/** Clears account default-tag references when a tag is deleted. Returns affected count. */
export function clearDefaultTagReferences(name: string): number {
  return (db.prepare('UPDATE accounts SET default_tag = NULL WHERE default_tag = ?')
    .run(name) as { changes: number }).changes;
}
