# Plan: Tag Rules (with per-account default tagging)

## Context

Today "rules" in Fungible only assign a **category** (`category_rules`) or rewrite a
**display name** (`name_rules`). Neither can apply a **tag** — tags are fully manual
(`tags` / `transaction_tags`, `core/tags.ts`). We want rules that **apply tags**, with
the headline use case being "tag everything imported for account X" (a per-account
default tag), expressed as an account-scoped, match-all tag rule.

The hard requirement: once a tag is applied, a human (or another rule) can **remove** it
and future syncs/rule-runs must **not** re-add it.

### Why this needs a suppression layer

Category rules re-apply constantly — on every rule save (`applyCategoriesToAll`,
`core/categorize.ts:89`) and on every synced row (`core/sync.ts:67`). They stay "sticky"
only because of the **`manual_category` override**: re-application skips rows where
`manual_category IS NOT NULL` (`categorize.ts:93`) and sync does
`category=COALESCE(manual_category, excluded.category)` (`sync.ts:75`).

Tags are **many-to-many**, so there is no single column to `COALESCE`. The faithful
translation of the `manual_category` pattern to tags is an explicit **suppression
table**: a record that "the human removed this rule-applied tag here." Without it, a
re-applied tag rule would re-add a removed tag and violate the requirement. This
suppression layer is the central, non-trivial part of this design.

Confirmed decisions carried over: backfill on rule save; deleting/clearing a rule leaves
already-applied tags in place; full TUI + GUI parity.

## Data model (`core/db.ts`)

Add two tables to the `CREATE TABLE IF NOT EXISTS` list (`:16-95`), mirroring
`category_rules` (`:38`):

```sql
CREATE TABLE IF NOT EXISTS tag_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  priority INTEGER NOT NULL DEFAULT 0,
  match_type TEXT NOT NULL CHECK(match_type IN ('name','regex','all')),
  pattern TEXT NOT NULL DEFAULT '',
  tag_id INTEGER NOT NULL,
  account_id TEXT,                 -- NULL = any account; set = scope to one account
  min_amount REAL,
  max_amount REAL,
  FOREIGN KEY (tag_id) REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS tag_rule_suppressions (
  transaction_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, tag_id)
);
```

- **Per-account default tag** = a `tag_rules` row with `account_id = X`,
  `match_type = 'all'` (pattern ignored), `tag_id = T`.
- `match_type = 'all'` is a new sentinel meaning "match every transaction in scope";
  `'name'`/`'regex'` behave exactly like category rules.

## Core changes

### New module `core/tag-rules.ts` (mirrors `categorize.ts`)
- `type TagRule = { match_type; pattern; tag_id; account_id; min_amount; max_amount }`.
- `loadTagRules()` — `SELECT ... FROM tag_rules ORDER BY priority DESC`.
- `tagRuleMatches(rule, accountId, name, merchant, amount)` — reuse `inAmountRange` and
  `matchesPattern` from `core/rule-utils.ts`; add account check
  (`rule.account_id == null || rule.account_id === accountId`); `'all'` short-circuits
  the pattern check.
- `applyTagRules(scope?: { txIds?: string[] })` — analog of `applyCategoriesToAll`:
  load rules, select candidate transactions (all, or a given id set), and for each
  matching (tx, rule) `INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)`
  **except** pairs present in `tag_rule_suppressions`. Returns count applied.

### `core/tags.ts` — suppression hooks (the stickiness mechanism)
**Decision: "always remember removals."** A removal is permanent until a deliberate
manual re-add. No rule — existing or created later — re-adds a removed tag.
- `removeTagFromTransaction(txId, tagId)` (`:47`): after the delete, **unconditionally**
  `INSERT OR IGNORE INTO tag_rule_suppressions (transaction_id, tag_id)`. No rule
  evaluation needed at removal time.
- `addTagToTransaction` / `addTagToTransactions` (`:40`,`:54`): after insert, `DELETE
  FROM tag_rule_suppressions` for those (tx, tag) pairs. **This manual re-add is the
  only way to undo a removal** — it clears the suppression so future rule-runs keep the
  tag. This is the path the TUI/GUI tag toggles and the agent `tag` tool already use, so
  the undo works everywhere a tag can be added.
- `deleteTag(id)` (`:13`): also delete `tag_rules WHERE tag_id = ?` and
  `tag_rule_suppressions WHERE tag_id = ?` in the batch.

### `core/rules.ts` — rule CRUD (mirror `saveCategoryRule`/`deleteCategoryRule`)
- `saveTagRule({ matchType, pattern, tagId, accountId, minAmount, maxAmount, editingId })`
  — insert/update, then call `applyTagRules()` to backfill (like `saveCategoryRule`
  calls `applyAll`, `:74`).
- `deleteTagRule(id)` — delete the rule only; leaves already-applied tags in place
  (matches category-rule delete semantics and the "leave existing" decision).

### `core/sync.ts` — apply on sync
After the added/modified upsert (`:63-89`), call
`applyTagRules({ txIds: [...added, ...modified].map(t => t.transaction_id) })`.
Suppression makes this safe for `modified`/existing rows (removed tags won't return).

### `core/accounts.ts` — apply on CSV import
In `importCsvTransactions` (`:65-97`), collect ids of rows where `rowsAffected > 0`, then
after the loop call `applyTagRules({ txIds: newIds })`.

## TUI — `tui/Rules.tsx`

The Rules screen already edits category and name rules. Add a **Tag rules** section/type
mirroring the category-rule editor:
- Fields: match type (`name` / `regex` / `all`), pattern (hidden/ignored when `all`),
  **tag** picker (`getTagOptions`, `core/tags.ts:26`), optional **account** scope
  (`getLinkedAccounts`, `core/queries.ts:515`; "Any account" = NULL), and min/max amount.
- Wire to `saveTagRule` / `deleteTagRule`.
- A per-account default tag is just: match type `all` + a chosen account + a tag.

## GUI — `gui/renderer/src/screens/Rules.tsx`

Add the same Tag-rules type for parity, mirroring the existing category-rule form
(select for match type, tag dropdown, account dropdown, amount inputs). Wire `saveTagRule`
/ `deleteTagRule` through the same `api` / IPC bridge that exposes the existing rule CRUD
(follow the category-rule path in `api/` + preload).

## Tests — `tests/` (vitest, mirror `tests/categorize.test.ts`)

- `tagRuleMatches`: name/regex/`all`, amount range, account scope (NULL vs specific).
- `applyTagRules` backfills matching transactions on `saveTagRule`.
- **Stickiness:** rule applies tag → `removeTagFromTransaction` → re-run
  `applyTagRules`/sync with the tx in `modified` → tag stays removed (suppression row present).
- **Removal precedes rule:** untag a tx with no matching rule → later create a matching
  rule → backfill does **not** re-add the tag (suppression blocks it).
- **Undo:** manual `addTagToTransaction` clears the suppression, and a subsequent
  `applyTagRules` keeps the tag.
- `deleteTagRule` leaves already-applied tags; `deleteTag` clears its rules + suppressions.
- CSV import + Plaid sync apply matching tag rules to new rows.

## Verification

1. `npx vitest run` — new + existing suites pass.
2. TUI: Rules screen → add a Tag rule (match `all`, account = some account, tag = T) →
   confirm existing transactions for that account get tag T. Remove T from one tx, then
   force a sync (`syncAll(true)`) and import a CSV into that account → removed tx stays
   untagged, brand-new rows get T.
3. Add a pattern tag rule (e.g. `name` contains "AMZN", any account) → matching txns tagged.
4. GUI: repeat rule creation via the GUI Rules screen for parity.

## Out of scope / notes

- One tag per rule; stack multiple rules for multiple tags.
- Deleting/disabling a rule does not retroactively strip tags it applied.
- Optional future nicety: a "Default tag" shortcut on the account-edit screen that
  creates an `account`-scoped `all` tag rule under the hood (the hybrid entry point).
- `priority` is included for parity with `category_rules`; ordering only matters if we
  later add rule precedence semantics.
