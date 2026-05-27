import { getPlaidClient } from './plaid.js';
import { db } from './db.js';
import { categorize } from './categorize.js';
import { applyNameRules } from './rename.js';
import { deduplicateCsvVsPlaid } from './dedup.js';
import { decryptToken } from './crypto.js';
import { applyDefaultTagToAccount } from './accountTags.js';
import type { Transaction } from 'plaid';

export async function syncTransactions(accessToken: string, itemId: string) {
  const cursorRow = db.prepare('SELECT cursor FROM sync_state WHERE account_id = ?').get(itemId) as { cursor: string } | undefined;
  let cursor = cursorRow?.cursor;

  let added: Transaction[] = [];
  let modified: Transaction[] = [];
  let removedIds: string[] = [];
  let hasMore = true;

  while (hasMore) {
    const response = await getPlaidClient().transactionsSync({
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

  // Upsert accounts and snapshot balances
  const accountsResponse = await getPlaidClient().accountsGet({ access_token: accessToken });
  const today = new Date().toISOString().slice(0, 10);
  const excludedRows = db.prepare('SELECT account_id FROM excluded_plaid_accounts').all() as { account_id: string }[];
  const excluded = new Set(excludedRows.map((r) => r.account_id));
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, name, type, subtype, mask, item_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, item_id=excluded.item_id
  `);
  const upsertBalance = db.prepare(`
    INSERT INTO balance_history (account_id, balance, date) VALUES (?, ?, ?)
    ON CONFLICT(account_id, date) DO UPDATE SET balance=excluded.balance
  `);
  for (const acct of accountsResponse.data.accounts) {
    if (excluded.has(acct.account_id)) continue;
    upsertAccount.run(acct.account_id, acct.name, acct.type, acct.subtype ?? null, acct.mask ?? null, itemId);
    const balance = acct.balances.current;
    if (balance !== null && balance !== undefined) {
      upsertBalance.run(acct.account_id, balance, today);
    }
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

  // Apply each account's default tag to its transactions (covers newly added ones).
  const itemAccounts = db.prepare('SELECT id FROM accounts WHERE item_id = ?').all(itemId) as { id: string }[];
  for (const a of itemAccounts) applyDefaultTagToAccount(a.id);

  // Save cursor and last_synced_at
  db.prepare(`
    INSERT INTO sync_state (account_id, cursor) VALUES (?, ?)
    ON CONFLICT(account_id) DO UPDATE SET cursor=excluded.cursor
  `).run(itemId, cursor ?? null);
  db.prepare('UPDATE plaid_items SET last_synced_at = ? WHERE item_id = ?').run(Date.now(), itemId);

  const dupes = deduplicateCsvVsPlaid();
  return { added: added.length, modified: modified.length, removed: removedIds.length, dupes };
}

export async function removeLink(itemId: string): Promise<{ plaidRemoved: boolean }> {
  const row = db.prepare('SELECT access_token FROM plaid_items WHERE item_id = ?').get(itemId) as { access_token: string } | undefined;
  let plaidRemoved = false;
  if (row) {
    // Best-effort: an expired/invalid token or network error must not block local cleanup.
    try {
      await getPlaidClient().itemRemove({ access_token: decryptToken(row.access_token) });
      plaidRemoved = true;
    } catch {}
  }
  db.prepare('DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE item_id = ?))').run(itemId);
  db.prepare('DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE item_id = ?)').run(itemId);
  db.prepare('DELETE FROM balance_history WHERE account_id IN (SELECT id FROM accounts WHERE item_id = ?)').run(itemId);
  db.prepare('DELETE FROM accounts WHERE item_id = ?').run(itemId);
  db.prepare('DELETE FROM sync_state WHERE account_id = ?').run(itemId);
  db.prepare('DELETE FROM plaid_items WHERE item_id = ?').run(itemId);
  return { plaidRemoved };
}

const DEBOUNCE_MS = 15 * 60 * 1000; // 15 minutes

export async function syncAll(force = false) {
  const items = db.prepare('SELECT item_id, access_token, last_synced_at FROM plaid_items').all() as {
    item_id: string; access_token: string; last_synced_at: number | null;
  }[];
  const results = [];
  for (const item of items) {
    if (!force && item.last_synced_at && Date.now() - item.last_synced_at < DEBOUNCE_MS) {
      results.push({ itemId: item.item_id, added: 0, modified: 0, removed: 0, dupes: 0, skipped: true });
      continue;
    }
    const result = await syncTransactions(decryptToken(item.access_token), item.item_id);
    results.push({ itemId: item.item_id, ...result, skipped: false });
  }
  return results;
}
