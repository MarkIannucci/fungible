import { plaidClient } from './plaid.js';
import { db } from './db.js';
import { categorize } from './categorize.js';
import { applyNameRules } from './rename.js';
import { deduplicateCsvVsPlaid } from './dedup.js';
import type { Transaction } from 'plaid';

export async function syncTransactions(accessToken: string, itemId: string) {
  const cursorRow = db.prepare('SELECT cursor FROM sync_state WHERE account_id = ?').get(itemId) as { cursor: string } | undefined;
  let cursor = cursorRow?.cursor;

  let added: Transaction[] = [];
  let modified: Transaction[] = [];
  let removedIds: string[] = [];
  let hasMore = true;

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor,
    });

    const data = response.data;
    added = added.concat(data.added);
    modified = modified.concat(data.modified);
    removedIds = removedIds.concat(data.removed.map((r) => r.transaction_id));
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  // Upsert accounts
  const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, name, type, subtype, mask)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name
  `);
  for (const acct of accountsResponse.data.accounts) {
    upsertAccount.run(acct.account_id, acct.name, acct.type, acct.subtype ?? null, acct.mask ?? null);
  }

  // Upsert added + modified
  const upsertTx = db.prepare(`
    INSERT INTO transactions (id, account_id, date, name, merchant_name, amount, category, raw_category, pending, display_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      date=excluded.date, name=excluded.name, merchant_name=excluded.merchant_name,
      amount=excluded.amount,
      category=COALESCE(manual_category, excluded.category),
      raw_category=excluded.raw_category,
      pending=excluded.pending,
      display_name=excluded.display_name
  `);

  for (const tx of [...added, ...modified]) {
    const rawCategory = tx.personal_finance_category?.primary ?? null;
    const category = categorize(tx.name, tx.merchant_name ?? null, rawCategory, tx.amount);
    const displayName = applyNameRules(tx.name, tx.amount);
    upsertTx.run(
      tx.transaction_id,
      tx.account_id,
      tx.date,
      tx.name,
      tx.merchant_name ?? null,
      tx.amount,
      category,
      rawCategory,
      tx.pending ? 1 : 0,
      displayName !== tx.name ? displayName : null,
    );
  }

  // Remove deleted
  if (removedIds.length > 0) {
    const placeholders = removedIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...removedIds);
  }

  // Save cursor
  db.prepare(`
    INSERT INTO sync_state (account_id, cursor) VALUES (?, ?)
    ON CONFLICT(account_id) DO UPDATE SET cursor=excluded.cursor
  `).run(itemId, cursor);

  const dupes = deduplicateCsvVsPlaid();
  return { added: added.length, modified: modified.length, removed: removedIds.length, dupes };
}

export async function syncAll() {
  const items = db.prepare('SELECT item_id, access_token FROM plaid_items').all() as { item_id: string; access_token: string }[];
  const results = [];
  for (const item of items) {
    const result = await syncTransactions(item.access_token, item.item_id);
    results.push({ itemId: item.item_id, ...result });
  }
  return results;
}
