# Journeys

Purpose: the end-to-end paths that matter, and where each one breaks today.

## 1. Cold start / onboarding

**Steps:** sign up for a free Plaid developer account (sandbox tier) → `fungible --setup` wizard writes Plaid + LLM keys to `~/.fungible/.env` → link a bank through Plaid Link → first sync pulls transactions and balances → `~/.fungible/key` encrypts the Plaid access tokens at rest.

**Escape hatch:** `fungible --demo` (or "Try Demo Mode" in the desktop app menu) runs an isolated pre-seeded dataset at `~/.fungible-demo/` — no account, no keys.

**Friction:**
- Getting a Plaid account is a developer flow, not a consumer one — the wizard can't remove that step, only document it.
- `~/.fungible/key` is unrecoverable. Delete it and every linked account must be re-linked. As of issue #179, this is no longer purely a documentation warning: `checkKeyHealth()` detects a missing or non-decrypting key and the Accounts screen shows a persistent banner naming the affected account count (TUI + GUI). What's still not enforced is *prevention* — nothing stops the key from being deleted or from drifting out of sync with the DB in the first place; the fix is detection-after-the-fact, not a guardrail. Backing the key up alongside the daily DB backup is available but opt-in/off by default (see `decisions.md`, 2026-09-16), so a user who wants recovery has to know to turn it on.
- The GUI doesn't start the MCP/API servers, so agent-via-Claude-Desktop needs the stdio config set up separately.
- No `.env` = no LLM keys = the agent and canvas are dead with a not-obvious error.

## 2. The monthly audit loop (core recurring use)

**Steps:** open Dashboard → pick the month → `[s]` scorecard → read which categories are OVER / TYPICAL / UNDER vs. the 12-period median → drill into an OVER category → Transactions to see the individual charges → optionally ask the agent "why is dining up".

**Friction:**
- Early in a calendar month the current period is thin; scorecard compares partial-to-partial (good) but the trailing-12 baseline on the Health screen still divides by 12 (see [`definitions.md`](definitions.md)).
- "Scorecard" is called "delta mode" in `docs/keybindings.md` — a user following the docs presses `d` and nothing happens.
- Uncategorized spend distorts the picture until rules are written; there's no nudge from the audit loop back to the Rules screen.

## 3. Scenario planning

**Steps:** ask the agent a "what if" → agent calls `generate_canvas` → produces a `CanvasSpec` with dials pre-filled from live data → `show_canvas` renders it → user adjusts dials and reads outputs live.

**Friction:**
- Single scenario only. No dated cash flows, no add/remove rows — see [`canvas-scope.md`](canvas-scope.md). A real early-retirement plan with a mortgage payoff and college costs can't be built. Design finalized 2026-09-17 (list/timeline element, Effort A) and being built now by core/tui/gui. Once merged this line resolves: `sum_active` is specifically a time-filtered sum, not a plain total, which is what makes "what changes when the mortgage ends" and "both kids in college at once" *answerable* rather than merely listable.
- Canvas outputs are arithmetic over scalar dials; anything iterative (year-by-year projection) has to be pre-baked into one `expr`. Design decided 2026-09-18 (table and chart output, both driven by a `year`-format dial, Effort B) and being built now by core/tui/gui — see `canvas-scope.md`. Table resolves the named need directly (scanning a range for a threshold crossing or a max/min, with exact figures); chart, initially deferred as too risky for parity, was reversed back into scope the same day once tui/gui found it cheap on both surfaces.
- Prior canvases are searchable by the generator, but the user has no browse-and-fork UI beyond `list_canvases` / `load_canvas`.
- Stale defaults on reopen: a canvas generated once and reopened weeks later still showed creation-day income/cash/net-worth numbers baked into dial defaults, even though the household's real numbers had moved on. Fixed by issue #145 Phase 1's dial `binding`, which re-resolves a closed set of live-data references at load/reopen time (see `canvas-scope.md`).

## 4. Correction

**Steps:** find a mis-categorized or mis-dated transaction → recategorize (`edit_transaction` / manual category, which pins it) → or reattribute its period (`set_transaction_date`, keeps the bank's posting date in `original_date`) → add a category or name rule so the fix survives the next sync.

**Friction:**
- A manual category and a rule are two different mechanisms; a user often sets a manual category when they meant to write a rule, and the fix doesn't generalize.
- Rules are global; there's no per-account scoping yet (planned), so "AMAZON = Business on this card only" isn't expressible.
- Reattribution is powerful but easy to misuse — there's no guard rail on moving a transaction to an arbitrary period.
