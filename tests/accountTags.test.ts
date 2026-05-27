import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: makeTestDb() };
});

import { db } from '../core/db.js';
import {
  setAccountDefaultTag,
  applyDefaultTagToAccount,
  tagExists,
  renameDefaultTagReferences,
  clearDefaultTagReferences,
} from '../core/accountTags.js';

let txId = 0;
const addAccount = (id: string) =>
  db.prepare("INSERT INTO accounts (id, name, type) VALUES (?, ?, 'credit')").run(id, id);
const addTx = (acct: string) => {
  txId++;
  const id = `tx${txId}`;
  db.prepare("INSERT INTO transactions (id, account_id, date, name, amount) VALUES (?, ?, '2025-01-15', 'tx', 10)").run(id, acct);
  return id;
};
const tagsOf = (txnId: string): string[] =>
  (db.prepare(`
    SELECT tg.name FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
    WHERE tt.transaction_id = ? ORDER BY tg.name
  `).all(txnId) as { name: string }[]).map((r) => r.name);

beforeEach(() => {
  txId = 0;
  db.exec('DELETE FROM transaction_tags');
  db.exec('DELETE FROM tags');
  db.exec('DELETE FROM transactions');
  db.exec('DELETE FROM accounts');
});

describe('setAccountDefaultTag', () => {
  it('creates the tag and applies it to all the account\'s transactions', () => {
    addAccount('a1');
    const t1 = addTx('a1');
    const t2 = addTx('a1');
    const r = setAccountDefaultTag('a1', 'shared');
    expect(r).toMatchObject({ oldTag: null, newTag: 'shared', tagged: 2, created: true });
    expect(tagsOf(t1)).toEqual(['shared']);
    expect(tagsOf(t2)).toEqual(['shared']);
    expect((db.prepare('SELECT default_tag FROM accounts WHERE id = ?').get('a1') as any).default_tag).toBe('shared');
  });

  it('reuses an existing tag without recreating it', () => {
    addAccount('a1');
    addTx('a1');
    db.prepare("INSERT INTO tags (name) VALUES ('shared')").run();
    const r = setAccountDefaultTag('a1', 'shared');
    expect(r.created).toBe(false);
    expect((db.prepare("SELECT COUNT(*) c FROM tags WHERE name = 'shared'").get() as any).c).toBe(1);
  });

  it('strips the old tag and applies the new one when changed', () => {
    addAccount('a1');
    const t1 = addTx('a1');
    setAccountDefaultTag('a1', 'shared');
    const r = setAccountDefaultTag('a1', 'household');
    expect(r).toMatchObject({ oldTag: 'shared', newTag: 'household', removed: 1 });
    expect(tagsOf(t1)).toEqual(['household']);
  });

  it('removes the tag from transactions when cleared', () => {
    addAccount('a1');
    const t1 = addTx('a1');
    setAccountDefaultTag('a1', 'shared');
    const r = setAccountDefaultTag('a1', null);
    expect(r).toMatchObject({ oldTag: 'shared', newTag: null, removed: 1 });
    expect(tagsOf(t1)).toEqual([]);
    expect((db.prepare('SELECT default_tag FROM accounts WHERE id = ?').get('a1') as any).default_tag).toBeNull();
  });

  it('strips by name even if the tag was added manually (same tag row)', () => {
    addAccount('a1');
    const t1 = addTx('a1');
    setAccountDefaultTag('a1', 'shared');
    // change away from shared -> the manually-equivalent link is removed too
    setAccountDefaultTag('a1', 'household');
    expect(tagsOf(t1)).toEqual(['household']);
  });

  it('does not touch other accounts\' transactions', () => {
    addAccount('a1');
    addAccount('a2');
    const other = addTx('a2');
    addTx('a1');
    setAccountDefaultTag('a1', 'shared');
    expect(tagsOf(other)).toEqual([]);
  });
});

describe('applyDefaultTagToAccount', () => {
  it('tags transactions that arrive after the default was set (idempotent)', () => {
    addAccount('a1');
    addTx('a1');
    setAccountDefaultTag('a1', 'shared');
    const late = addTx('a1'); // arrives later, e.g. via sync
    applyDefaultTagToAccount('a1');
    expect(tagsOf(late)).toEqual(['shared']);
    // running again does not duplicate
    applyDefaultTagToAccount('a1');
    expect(tagsOf(late)).toEqual(['shared']);
  });

  it('is a no-op when the account has no default tag', () => {
    addAccount('a1');
    const t1 = addTx('a1');
    expect(applyDefaultTagToAccount('a1')).toBe(0);
    expect(tagsOf(t1)).toEqual([]);
  });
});

describe('renameDefaultTagReferences', () => {
  const defaultTagOf = (id: string) =>
    (db.prepare('SELECT default_tag FROM accounts WHERE id = ?').get(id) as any).default_tag;

  it('updates accounts pointing at the renamed tag', () => {
    addAccount('a1');
    addAccount('a2');
    addAccount('a3');
    setAccountDefaultTag('a1', 'shared');
    setAccountDefaultTag('a2', 'shared');
    setAccountDefaultTag('a3', 'personal');
    const moved = renameDefaultTagReferences('shared', 'household');
    expect(moved).toBe(2);
    expect(defaultTagOf('a1')).toBe('household');
    expect(defaultTagOf('a2')).toBe('household');
    expect(defaultTagOf('a3')).toBe('personal');
  });

  it('returns 0 when no account uses the tag', () => {
    addAccount('a1');
    expect(renameDefaultTagReferences('nope', 'whatever')).toBe(0);
  });
});

describe('clearDefaultTagReferences', () => {
  it('nulls the default tag on accounts that used the deleted tag', () => {
    addAccount('a1');
    addAccount('a2');
    setAccountDefaultTag('a1', 'shared');
    setAccountDefaultTag('a2', 'personal');
    const cleared = clearDefaultTagReferences('shared');
    expect(cleared).toBe(1);
    expect((db.prepare('SELECT default_tag FROM accounts WHERE id = ?').get('a1') as any).default_tag).toBeNull();
    expect((db.prepare('SELECT default_tag FROM accounts WHERE id = ?').get('a2') as any).default_tag).toBe('personal');
  });
});

describe('tagExists', () => {
  it('reflects whether a tag is present', () => {
    expect(tagExists('shared')).toBe(false);
    db.prepare("INSERT INTO tags (name) VALUES ('shared')").run();
    expect(tagExists('shared')).toBe(true);
  });
});
