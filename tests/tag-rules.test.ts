import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

import { db } from '../core/db.js';
import { applyTagRules, tagRuleMatches, countTagRuleMatches, type TagRule } from '../core/tag-rules.js';
import { addTagToTransaction, removeTagFromTransaction, deleteTag, getTransactionTagIds } from '../core/tags.js';
import { saveTagRule, deleteTagRule } from '../core/rules.js';

let tagSeq = 0;
async function makeTag(name: string): Promise<number> {
  tagSeq++;
  await db.execute({ sql: 'INSERT INTO tags (name) VALUES (?)', args: [name] });
  const r = await db.execute({ sql: 'SELECT id FROM tags WHERE name = ?', args: [name] });
  return Number((r.rows[0] as unknown as { id: number }).id);
}

let txSeq = 0;
async function insertTx(name: string, accountId = 'a', amount = 10): Promise<string> {
  txSeq++;
  const id = `tx${txSeq}`;
  await db.execute({
    sql: `INSERT INTO transactions (id, account_id, date, name, amount, category, pending, ignored)
          VALUES (?, ?, '2025-01-01', ?, ?, 'Uncategorized', 0, 0)`,
    args: [id, accountId, name, amount],
  });
  return id;
}

async function insertRule(r: Partial<TagRule> & { tag_id: number }): Promise<number> {
  const res = await db.execute({
    sql: 'INSERT INTO tag_rules (priority, match_type, pattern, tag_id, account_id, min_amount, max_amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [10, r.match_type ?? 'all', r.pattern ?? '', r.tag_id, r.account_id ?? null, r.min_amount ?? null, r.max_amount ?? null],
  });
  return Number(res.lastInsertRowid);
}

const hasTag = async (txId: string, tagId: number) => (await getTransactionTagIds(txId)).has(tagId);

beforeEach(async () => {
  txSeq = 0; tagSeq = 0;
  for (const t of ['transaction_tags', 'tag_rule_suppressions', 'tag_rules', 'tags', 'transactions']) {
    await db.execute(`DELETE FROM ${t}`);
  }
});

describe('tagRuleMatches', () => {
  const rule = (over: Partial<TagRule>): TagRule => ({
    match_type: 'name', pattern: '', tag_id: 1, account_id: null, min_amount: null, max_amount: null, ...over,
  });

  it('name substring, case-insensitive', () => {
    expect(tagRuleMatches(rule({ match_type: 'name', pattern: 'amzn' }), 'a', 'AMZN Mktp US', null, 10)).toBe(true);
    expect(tagRuleMatches(rule({ match_type: 'name', pattern: 'amzn' }), 'a', 'Target', null, 10)).toBe(false);
  });

  it('regex against name and merchant', () => {
    expect(tagRuleMatches(rule({ match_type: 'regex', pattern: '^amzn' }), 'a', 'AMZN*123', null, 10)).toBe(true);
    expect(tagRuleMatches(rule({ match_type: 'regex', pattern: '^amzn' }), 'a', 'SQ', 'AMZN Digital', 10)).toBe(true);
  });

  it('all matches everything in scope', () => {
    expect(tagRuleMatches(rule({ match_type: 'all' }), 'a', 'anything', null, 10)).toBe(true);
  });

  it('account scope: null = any, specific = that account only', () => {
    expect(tagRuleMatches(rule({ match_type: 'all', account_id: null }), 'x', 'n', null, 10)).toBe(true);
    expect(tagRuleMatches(rule({ match_type: 'all', account_id: 'work' }), 'work', 'n', null, 10)).toBe(true);
    expect(tagRuleMatches(rule({ match_type: 'all', account_id: 'work' }), 'home', 'n', null, 10)).toBe(false);
  });

  it('amount range gates the match', () => {
    expect(tagRuleMatches(rule({ match_type: 'all', min_amount: 100 }), 'a', 'n', null, 50)).toBe(false);
    expect(tagRuleMatches(rule({ match_type: 'all', min_amount: 100 }), 'a', 'n', null, 150)).toBe(true);
  });
});

describe('applyTagRules', () => {
  it('backfills matching transactions in the account scope', async () => {
    const tag = await makeTag('Work');
    const t1 = await insertTx('Lunch', 'work');
    const t2 = await insertTx('Lunch', 'home');
    await insertRule({ match_type: 'all', tag_id: tag, account_id: 'work' });

    const applied = await applyTagRules();
    expect(applied).toBe(1);
    expect(await hasTag(t1, tag)).toBe(true);
    expect(await hasTag(t2, tag)).toBe(false);
  });

  it('saveTagRule backfills existing transactions', async () => {
    const tag = await makeTag('Amazon');
    const t1 = await insertTx('AMZN Mktp');
    const t2 = await insertTx('Target');
    const applied = await saveTagRule({ matchType: 'name', pattern: 'amzn', tagId: tag, minAmount: null, maxAmount: null });
    expect(applied).toBe(1);
    expect(await hasTag(t1, tag)).toBe(true);
    expect(await hasTag(t2, tag)).toBe(false);
  });

  it('does not double-count already-applied tags on re-run', async () => {
    const tag = await makeTag('Work');
    await insertTx('Lunch', 'work');
    await insertRule({ match_type: 'all', tag_id: tag, account_id: 'work' });
    expect(await applyTagRules()).toBe(1);
    expect(await applyTagRules()).toBe(0);
  });
});

describe('stickiness (suppression)', () => {
  it('removed tag stays gone when rules re-run', async () => {
    const tag = await makeTag('Work');
    const t1 = await insertTx('Lunch', 'work');
    await insertRule({ match_type: 'all', tag_id: tag, account_id: 'work' });
    await applyTagRules();
    expect(await hasTag(t1, tag)).toBe(true);

    await removeTagFromTransaction(t1, tag);
    expect(await hasTag(t1, tag)).toBe(false);

    // simulate sync/import re-run scoped to the modified row
    await applyTagRules({ txIds: [t1] });
    expect(await hasTag(t1, tag)).toBe(false);
  });

  it('a removal before any rule blocks a later-created rule (always remember)', async () => {
    const tag = await makeTag('Work');
    const t1 = await insertTx('Lunch', 'work');
    // manual tag then removal, with no rule yet
    await addTagToTransaction(t1, tag);
    await removeTagFromTransaction(t1, tag);

    // now a matching rule is created and backfilled
    await saveTagRule({ matchType: 'all', pattern: '', tagId: tag, minAmount: null, maxAmount: null, accountId: 'work' });
    expect(await hasTag(t1, tag)).toBe(false);
  });

  it('manual re-add clears the suppression so rules apply again', async () => {
    const tag = await makeTag('Work');
    const t1 = await insertTx('Lunch', 'work');
    await insertRule({ match_type: 'all', tag_id: tag, account_id: 'work' });
    await applyTagRules();
    await removeTagFromTransaction(t1, tag);

    await addTagToTransaction(t1, tag); // undo
    expect(await hasTag(t1, tag)).toBe(true);
    const sup = await db.execute({ sql: 'SELECT 1 FROM tag_rule_suppressions WHERE transaction_id = ? AND tag_id = ?', args: [t1, tag] });
    expect(sup.rows.length).toBe(0);

    await applyTagRules({ txIds: [t1] }); // stays
    expect(await hasTag(t1, tag)).toBe(true);
  });
});

describe('rule lifecycle', () => {
  it('deleteTagRule leaves already-applied tags', async () => {
    const tag = await makeTag('Work');
    const t1 = await insertTx('Lunch', 'work');
    const ruleId = await insertRule({ match_type: 'all', tag_id: tag, account_id: 'work' });
    await applyTagRules();
    await deleteTagRule(ruleId);
    expect(await hasTag(t1, tag)).toBe(true);
  });

  it('deleteTag clears its rules and suppressions', async () => {
    const tag = await makeTag('Work');
    const t1 = await insertTx('Lunch', 'work');
    await insertRule({ match_type: 'all', tag_id: tag, account_id: 'work' });
    await applyTagRules();
    await removeTagFromTransaction(t1, tag);

    await deleteTag(tag);
    const rules = await db.execute('SELECT COUNT(*) c FROM tag_rules');
    const sups = await db.execute('SELECT COUNT(*) c FROM tag_rule_suppressions');
    expect(Number((rules.rows[0] as unknown as { c: number }).c)).toBe(0);
    expect(Number((sups.rows[0] as unknown as { c: number }).c)).toBe(0);
  });
});

describe('countTagRuleMatches', () => {
  it('counts all-in-scope, name and regex', async () => {
    await insertTx('AMZN', 'work');
    await insertTx('Target', 'work');
    await insertTx('AMZN', 'home');
    expect(await countTagRuleMatches('all', '', 'work')).toBe(2);
    expect(await countTagRuleMatches('all', '', null)).toBe(3);
    expect(await countTagRuleMatches('name', 'amzn', null)).toBe(2);
    expect(await countTagRuleMatches('regex', '^amzn', 'work')).toBe(1);
  });
});
