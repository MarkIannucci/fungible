# Implementation Plan: Unified Filter Panel

A shared, keyboard-driven filter panel across Dashboard, Transactions, and Trends,
per the proposal in [issue #44](https://github.com/tomfunk/fungible/issues/44#issuecomment-4623842591).
Filter state is session-global and follows you between the three screens.

## Decisions locked in

- **Cross-dimension = AND, within-dimension = OR**, non-configurable. Owner is an
  independent AND'd dimension implemented as an `account_id` constraint, so
  "Owner=Mark AND Account=Chase" = Chase accounts owned by Mark.
- **Tags are tri-state** per row, cycling `[ ] → [✓ has] → [✗ lacks]`; multiple
  tags AND together.
- **Session-only** state, no disk persistence.
- Panel **replaces** Space-to-filter and `[c]` on the Dashboard account view.
- Free-text `/` search stays a **separate ephemeral mechanism** (not a panel
  section), leaving room to grow it into omnisearch later.
- The `filter-txs-tags-has-lacks` branch is **abandoned**; we salvage its
  `tagFilterClause` SQL pattern and its tag-filter tests.
- **Invert key = `i`** (safe — the panel is modal and gates host-screen input).
- **Drill-downs write into the shared filter** (e.g. clicking a category sets
  `categories:[that one]`, leaving the other dimensions untouched) so there is a
  single source of truth and the destination screen's header reflects it.

## Model & semantics

The "empty vs all" subtlety is the one real modeling trap:

- The **query-facing filter** treats an **absent dimension = no constraint (all)**,
  a **present array = exactly those** (empty array → match nothing).
- The **panel** works internally with an explicit selected `Set` initialized to the
  full universe. On apply it serializes: full universe → omit the dimension; subset
  → the array; none → empty array.

This round-trips cleanly when re-opening the panel and dodges the invalid `IN ()`
problem.

## PR 1 — Data layer + shared state (no visible UI change)

The risky, mechanical half. Filter starts empty, so behavior is identical to today;
this PR is pure refactor + plumbing and is reviewable on its own.

1. **`core/filters.ts` (new)** — shared by core and TUI:
   - `TagPredicate = { name: string; mode: 'has' | 'lacks' }`
   - `Filter = { categories?: string[]; accounts?: string[]; owners?: string[]; tags?: TagPredicate[] }`
   - helpers: `isFilterActive(f)`, `filterSummary(f)` → `"2 accounts, 4 categories"`
     for the header hint.

2. **`buildFilterClause(filter, alias)`** (in `core/queries.ts`, generalizing the
   salvaged `tagFilterClause`): emits an `AND …`-prefixed clause + parameterized args.
   - categories → `${alias}.category IN (…)`
   - accounts → `${alias}.account_id IN (…)`
   - owners → `${alias}.account_id IN (SELECT id FROM accounts WHERE COALESCE(NULLIF(TRIM(owner),''),'Unassigned') IN (…))`
     (handles the `Unassigned` bucket the owner split already uses)
   - tags → one `EXISTS`/`NOT EXISTS` per predicate
   - empty array on any dim → `1=0`; absent → skipped.

3. **Thread `filter?: Filter` through the query layer**, replacing the current
   one-off `accountId?`/`tagFilter?` params:
   - `queries.ts`: `getRangeSummary`, `getMerchantSummary`, `getFlexSummary`,
     `getUncategorizedCount`, `queryCategoryTotals`, `queryFlexTotals`, the
     rolling/comparison series, `countSearchMatches`, and `getTransactions`
     (replace its inline category/tag/account with `buildFilterClause`; keep
     `search`/`txType`/`flex`/`sort`).
   - `trends.ts`: `getPeriodTotals`, `getSearchPeriodTotals`,
     `getSearchMatchingPeriods`. Splice the clause into each `WHERE`; keep their
     existing args parameterized.
   - Owner split (`getOwnerSpending`) groups *by* owner, so it ignores the owner
     dimension but still honors the other three.

4. **`tui/FilterContext.tsx` (new)** — mirrors `RefreshContext`/`TypingContext`:
   `{ filter, setFilter }`, `useFilter()`. Wrap `<AppInner/>` in `<FilterProvider>`
   in `App.tsx`. Session-only `useState`.

5. **Shrink `TxFilter`** to navigation-only fields
   (`from/to/range/anchor/search/txType/flex/canvasSpec`); the four structured
   dimensions move to `FilterContext`. Update Dashboard/Transactions/Trends to read
   `useFilter()` and pass `filter` into their queries. Migrate drill-downs to
   `setFilter(...)`.

6. **Tests:** `buildFilterClause` unit tests (each dim, multi-select, owner subquery
   incl. `Unassigned`, tag has/lacks/multi, empty=nothing, absent=all) — adapt the
   salvaged tag tests; plus `getTransactions`/`getRangeSummary`/trends with a filter
   applied.

## PR 2 — Filter panel UI

7. **`tui/FilterPanel.tsx` (new)**, built on the existing `ModalPanel`:
   - Loads universes via `getFilterOptions()` (`core/queries.ts`): categories,
     accounts (id/name/owner), owners derived from accounts (`Unassigned` bucket),
     tags.
   - State: focused section, per-section selection `Set` (+ tag tri-state map),
     per-section cursor.
   - Init from current `filter` (absent dim → all checked; array → those; `[]` → none).
   - Keys (captured while open): `Esc` close (discards the draft), `←/→` section,
     `↑/↓` row, `Space` toggle (tags cycle), `a` select-all, `n` select-none,
     `i` invert (set dims complement; tags swap has↔lacks), `c` clear all sections,
     `Enter` apply → serialize → `setFilter` → close.
   - **Deferred** (not in the shipped panel): `/` inline search within a section
     (narrows list, selections persist) and `f` to close the panel — `f` only
     opens it today. Both are follow-up candidates; inline search matters most
     once a category universe outgrows the visible window.

8. **Wire into the three screens:** local `panelOpen` state, render `<FilterPanel>`,
   `f` toggles it, and gate the host `useInput` while open (same pattern as
   `searchMode`). Header hint via `filterSummary(filter)` in `PageHeader`, shown only
   when `isFilterActive`.

9. **Remove** the Dashboard account-view Space-to-filter + `[c]` plumbing. Keep the
   *owner spending* DashView as a display — it's separate from the owner filter
   dimension.

10. **Tests** (`tests/tui/screens.test.tsx`): open/close, toggle + apply updates the
    summary, **filter persists across a screen switch** (set on Dashboard, switch to
    Transactions, assert applied), `Esc` restores.

## Search composition

`/` search and the panel filter compose with AND. The transaction list already
applies search as a post-filter on top of the WHERE clause, so it composes for free.
The only change: Dashboard's separate search-recompute path
(`getSearchFilteredData`/`countSearchMatches`) must also take the shared filter.

## Risks / watch-items

- Input gating where modal + Chat focus + `/` search overlap — get the early-returns
  right.
- `trends.ts` builds SQL via template strings (e.g. `view.flex` is interpolated);
  keep our additions parameterized via args, don't interpolate filter values.
- The empty-vs-all serialization is the most bug-prone bit — covered by dedicated
  unit tests in PR 1.

## Out of scope (possible later)

- **`/` inline section search and `f`-to-close in the panel** — deferred from
  PR 2's key map (see item 7).
- **Live preview of filter on dashboard** - as I make decisions on the filter panel
  update the numbers on the dashboard above. 
- **Omnisearch** (`tag:happyhour`, `!tag:x`, `owner:Mark`) as a power-user
  accelerator that mutates the same `FilterContext` — a possible PR 3.
- Configurable AND/OR logic.
- Cross-restart filter persistence.


## Live preview plan:
1. FilterContext.tsx — add a preview: Filter | null state alongside the history. Have the filter value that useFilter() returns become preview ?? current. Every view instantly gains live preview with zero changes, because they all just read filter. Expose setPreview, and expose the committed value separately for the panel's hydration.
2. FilterPanel.tsx — the serialization block inside apply() (the selectionToDim calls building next) gets extracted into a draftFilter memo. A useEffect publishes it via setPreview(draftFilter) as the draft changes, and clears it (setPreview(null)) on unmount. Enter commits via setFilter as today — one history push, so the Esc step-back behavior we just built stays clean. Esc just clears the preview, so cancel restores the original view for free.

That last point is the nice part of the design: because preview bypasses pushFilter, toggling 15 checkboxes while previewing doesn't pollute the filter history — only the final Enter does.
