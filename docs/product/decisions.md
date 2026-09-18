# Decision log

Purpose: product/UX decisions and why, newest first. Each entry: date, decision, why, status.

---

### 2026-09-18 — Chart reversed back into scope alongside table (issue #145, Effort B follow-up)

**Decision:** ship `chart` alongside `table` in this same cut, superseding the "chart stays out of scope" call below made earlier the same day. Both elements share one `ProjectionDef` schema (`label`, `driver`, `series: { label, expr, format, color?, signed? }[]`). GUI renders `chart` as a real `Recharts` `ComposedChart`; TUI renders it as a one-row Unicode sparkline (`▁▂▃▄▅▆▇█`) plus a plain numbers line.
**Why:** the earlier deferral rested on chart being a materially bigger, riskier parity lift than table — different rendering technologies on each surface, different failure modes. Direct planning conversations with tui and gui found that premise wrong on both sides: GUI already has Recharts wired up for the Net Worth/Trends screens and can reuse the exact same `ComposedChart`/`chartTheme` recipe plus the click-to-jump-to-dial interaction already live in `Trends.tsx`; TUI's proposal is not a multi-row terminal chart but a single sparkline row plus a numbers line, about one row of screen space. `parity.md` also already sanctions "charts vs. ASCII bars" as an acceptable per-surface rendering divergence — same data, same journey outcome, different rendering technology — which was the parity concern the original recommendation was largely built on. With both sides this cheap and the parity objection already resolved by existing policy, there was no remaining reason to hold chart back once table was already justified. Table's case for shipping (precision over impression, resolves the named journey-3 friction directly) is unchanged and still the stronger of the two.
Also reconciles the point-count numbers so they don't read as a contradiction later: the original 40-recommended/50-ceiling table cap and core's separate 120-point runtime safety cap are different things, not competing numbers. Final shape is three layers — (1) 40-step **prompt guidance** to the generator, unchanged from the original recommendation; (2) a 120-point **runtime safety cap** as a backstop, with resample-to-fit (never truncating the horizon) if a driver dial's range would exceed it; (3) **TUI downsamples independently** on top of that for its own sparkline/table display budget. 40 is authoring guidance; 120 is a hard runtime ceiling against a pathological dial range; they answer different questions.
**Status:** decided; `canvas-scope.md`'s Effort B section rewritten to reflect chart shipping (title, component-model table, reasoning, point-handling), `journeys.md` journey 3 line corrected to no longer say table resolves this "on its own." Building now, core/tui/gui in parallel.

### 2026-09-18 — Canvas gains table output, driven by a year-format dial only; chart stays out of scope (issue #145, Effort B) — SUPERSEDED same day, see entry above

**Decision:** ship a `table` output element — a `driver` naming an existing `year`-format dial, one or more `columns` (each `label` + `expr`), one rendered row per year from the driver's `min` to `max`. No `chart` element in this cut. The driver is restricted to `format: 'year'` dials only, not any bounded numeric dial. Point count is capped: recommend 40 as the default/soft target, 50 as a hard ceiling — generation should clamp or refuse rather than render an unusably long table when a driver dial's range exceeds it.
**Why:** journey 3's one remaining named friction is explicit — "anything iterative (year-by-year projection) has to be pre-baked into one `expr`" (`journeys.md`). The concrete blocked question is "am I ever underwater between now and retirement," "what's the worst year with both kids in college at once" — today that means scrubbing a `plan_year` dial across ~20 one-at-a-time steps and remembering each result, which is exactly the friction `canvas-scope.md`'s growth bar exists to catch, not a nice-to-have. A table resolves it directly and precisely (scan a column for the first negative or the max, exact figures — a financial decision, not an impression). Chart is deferred, not rejected: it is a materially bigger, materially riskier lift for parity than a table — a terminal chart (TUI) and a real chart (GUI) are different rendering technologies with different failure modes, while a TUI table and a GUI table are the same grid two ways, far easier to keep "same data, same conclusion" (`parity.md`) between. `canvas-scope.md` already called visual rendering "a nicety on top" when the list primitive shipped; nothing has changed that judgment. The driver stays restricted to `year` format because that's the only named use case and matches `sum_active`'s existing convention — no scenario has named a need to iterate a table over a percent/dollar dial's range, so generalizing now would be unrequested scope, against this project's repeated convention of shipping the narrow thing that resolves the named need. The point cap is sanity-checked against Thomas's own horizon (`[[project_life_plan]]`): kids currently 5 and 3, college starting roughly 13 and 15 years out, cash-to-$160k around 2029 — a realistic planning canvas spans on the order of 20-30 years, comfortably inside a 40-50 point cap.
**Status:** proposed for core/tui/gui to build against; not yet built. `canvas-scope.md` updated with the `table` element row and a dedicated "Resolved" section; `journeys.md` journey 3 annotated.

### 2026-09-17 — Canvas list/timeline primitive: row shape and aggregation scope (issue #145, Effort A)

**Decision:** the still-open "canvas has no list primitive" question in `canvas-scope.md` resolves to option (a) — grow canvas a real list/timeline element, as its own effort separate from the smaller inter-output-references work. Row shape: `{ label: string, amount: number, start_year: number, end_year?: number }` — `amount` signed and monthly (app-wide unit convention), `end_year` optional and defaulting to `Infinity`, one row per repeating instance (e.g. one row per kid's college, not a multiplier — their windows differ). One-time costs are a row with `start_year == end_year`, not a separate mode field. Aggregation ships with exactly one new `expr` builtin in v1 — `sum_active(list_key, year_expr)`, summing `amount` where `start_year <= year_expr <= end_year` — driven by an ordinary "Year" dial using canvas's existing move-a-dial-see-it-live interaction. No `count()`/`min()`/`avg()`, no cross-row references, no chart rendering in this cut.
**Why:** sanity-checked against the exact blocking case named in journey 3 ("a real early-retirement plan with a mortgage payoff and college costs can't be built") and against Thomas's own life-plan shape (two kids starting college in different years, per `[[project_life_plan]]`). A multiplier field doesn't survive that check — the two kids' windows differ — so it's one row per instance. An unconditional sum-over-all-rows (no date filter) was considered and rejected for v1: it doesn't answer the time-dependent question the journey is actually asking ("what happens when the mortgage ends," "both kids in college at once"), so shipping Effort A without any time-aware aggregation would still leave the journey blocked. The one-function aggregate keeps the `expr` grammar extension to the size core asked for while actually clearing the "blocks a journey" bar `canvas-scope.md` sets for growing canvas.
**Status:** decided; `canvas-scope.md` updated with the full shape and the deferred-list (multi-list aggregation, dial-driven row amounts, chart rendering). Not yet built — core/tui/gui to propose schemas/UI against this shape next.

### 2026-09-17 — Canvas list rows persist; dial adjustments still don't (issue #145, Effort A)

**Decision:** list row add/remove/edit writes back to saved history and survives navigating away and reopening the canvas. Every other piece of canvas state — dial adjustments, `visible` branches — stays ephemeral view state that resets on reload, unchanged.
**Why:** a follow-up question after the row-shape recommendation above. Adding a mortgage-payoff row or editing a college-cost estimate reads as data entry, not calibration — losing it on navigation would be a real regression in trust, unlike a dial nudge the user expects to reset. This is the first canvas interaction that writes back to saved history rather than adjusting live view state, and it's scoped deliberately narrowly: an exception for list rows, not a precedent that other canvas state (dials included) should start persisting too.
**Status:** decided; `canvas-scope.md` updated with a dedicated persistence note flagging it as a documented exception. Building now alongside the rest of Effort A.

### 2026-09-16 — Canvas gains toggle/select dials, `visible`, and `binding` (issue #145, Phase 1)

**Decision:** ship four additive changes to the canvas component model: a `toggle` dial format (boolean on/off), a `select` dial format (enum, value = index into an `options` array), a `visible?: string` condition on any element (reuses the existing `expr` evaluator against dial values, fails open on error), and a `binding?: string` on dials — a closed set of ~12 named live-data references (e.g. `net_worth`, `cash_balance`, `monthly_income_12mo_avg`, `self_age`) resolved at canvas load/reopen time, falling back to the hardcoded `default` if unresolvable. Binding resolution is load-time only, never mid-session, so it can't clobber a value the user has already touched.
**Why:** `binding` fixes deficiency #10 — a canvas reopened weeks later was still showing creation-day income/cash/net-worth numbers baked in at generation time. `toggle`/`select`/`visible` round out expressiveness for scenarios that branch on a yes/no or a small enum (e.g. "include pension?", "filing status") without needing a new element type.
**Status:** shipped, core/tui/gui in parallel. Deferred, explicitly not part of this phase: list/timeline element, inter-output references, year dial format, chart output, tabular output, trigger/action buttons. This phase is orthogonal to the open "canvas has no list primitive" question in `canvas-scope.md` — it does not add repetition, add/remove, or row aggregation, and should not be read as an implicit choice among that section's options (a)/(b)/(c). That question remains open by choice/sequencing, not oversight.

### 2026-09-16 — Key-in-backup is opt-in, off by default (issue #179)

**Decision:** the daily backup covers only the database by default. Copying `~/.fungible/key` into the backup is a separate, opt-in setting (`backupIncludeKey`, off by default), surfaced as a toggle in Settings on both TUI and GUI, with a one-time notice on the TUI Setup 'done' step.
**Why:** core's initial proposal defaulted this on, reasoning that losing the key already destroys every Plaid link (issue #179's core complaint) so backing it up prevents that. Overruled: backups routinely leave the machine — cloud sync, external drives, NAS — and today's encrypted-at-rest guarantee holds because the key and the data it decrypts are never in the same place. Defaulting the key into the backup would silently weaken that guarantee for every user, in exchange for a convenience only some users want. This is a security-posture change with no existing governance, so it needed an explicit call rather than an implementation default.
**Status:** shipped. Unconditional part of the fix — `checkKeyHealth()` detecting `missing_key`/`decrypt_failed` and a persistent Accounts-screen warning banner naming the affected account count — ships for everyone regardless of this setting. Core: PR #188 (`core/key-health.ts`, `core/settings.ts`, `core/backup.ts`). GUI: PR #189 (Settings toggle). TUI: PR #190 (Settings toggle + Setup notice) — note as of this writing the TUI PR has an in-branch revert/reapply cycle on `tui/key-health-179`; confirm the reapply landed before treating TUI as closed.

### 2026-09-15 — Two "12-month average" definitions stay, disambiguated by label (issue #178)

**Decision:** keep both trailing-12 implementations rather than reconciling to one formula. The Health/runway/FIRE basis (rolling trailing-365-day window ÷ 12) is labeled **"trailing 12mo"**; the Dashboard scorecard/drift basis (12 complete calendar periods, each clipped to the current period's elapsed-day count) is labeled **"12 complete periods,"** shown as **"vs typical month (12 complete periods)"** alongside the existing mode name.
**Why:** the two numbers serve different purposes — a smooth trailing average for runway/FIRE math vs. a fair same-point-in-period comparison for category drift — so collapsing them to one formula would make one use case worse to fix a naming collision. Disambiguating by label keeps both correct for their job.
**Status:** decided; `definitions.md` updated. Core is adding `basis`/`basisLabel` fields to `HealthData`, `FinancialHealth`, and `DriftSlice` sourced from a shared label map in `core/dateUtils.ts`, and updating `core/tools.ts`/`core/canvas-agent.ts` text. tui/gui are updating the Dashboard scorecard header/column text; Health screen captions are unchanged (no ambiguity risk there). `docs/keybindings.md` and `docs/integrations.md` updated to match.

### 2026-09-07 — Loans count as liabilities in net worth

**Decision:** loan balances (mortgage, auto, student) are subtracted in the net worth calculation: `(depository + investment + other, positive) − (credit + loan)`. FIRE progress moves with loan debt.
**Why:** net worth should reflect what you owe. Anyone who wants a home to net out can add it as a manual asset, or simply not link the mortgage — the reverse (silently ignoring a six-figure liability) is the more misleading default.
**Status:** decided; core change in flight (PR A) in `core/health.ts` / `core/account-class.ts`. `definitions.md` net-worth row already updated.

### 2026-09-07 — Flat repo layout, no monorepo

**Decision:** fungible stays a flat repo (`core/`, `tui/`, `gui/`, `mcp/`, `api/`, and a future `web/`). No workspace packages. `core/` exposes `setDb()` so each surface injects its own libsql client.
**Why:** an earlier `packages/` / `apps/` monorepo attempt was abandoned — the tooling overhead bought nothing for a project this size with one shared logic layer.
**Status:** in effect. See `PLANS.md`.

### 2026-09-07 — Web app is a future version of the GUI, not a separate codebase

**Decision:** if a web app ships, it's a Vite + React build reusing the same `core/` and mirroring the GUI's screens (`@libsql/client-wasm` + OPFS in the browser). Not a rewrite.
**Why:** parity is the whole point (see `parity.md`). A separate web codebase would immediately drift.
**Status:** planned, mycelium-backed. Not started.

### 2026-09-07 — Paid tier deferred

**Decision:** no paid tier in the near term. If built, it's a hosted web app on the mycelium backend whose subscription covers Plaid plus a small agent LLM budget; self-hosted / BYOK stays free and unchanged.
**Why:** willingness to pay is unproven. The free BYOK flow is the product today.
**Status:** deferred. Sync-schema columns are already inert-present for BYOK users so the door stays open.

### 2026-09-07 — Canvas is the catch-all for calculators

**Decision:** "what if" questions become agent-generated canvases, not new screens.
**Why:** keeps the 10 core screens from sprawling a tab per scenario type.
**Status:** in effect. Known limit: no dynamic/dated lists — see `canvas-scope.md`.

### 2026-09-07 — No budgeting feature; audit-first instead

**Decision:** fungible will not add envelope / zero-based / any budgeting. The spending model is fixed/flexible/discretionary tagging plus scorecard mode.
**Why:** the target user audits rather than budgets. A budget feature would pull the product toward a different user and a different competitor set.
**Status:** in effect. Note: `finance-guide.ts` still *describes* budgeting frameworks for the agent to explain — that's advice, not a feature.

### 2026-09-07 — No mobile app

**Decision:** no native mobile app, ever, as currently scoped.
**Why:** keyboard-first, terminal-comfortable target user; a mobile app is a different product with a different interaction model and maintenance burden.
**Status:** in effect.

### 2026-09-07 — TUI/GUI parity is the default

**Decision:** every user-facing feature ships on both surfaces with the same concepts, data, vocabulary, and journey outcomes. Layout and input mechanics differ.
**Why:** one engine, two views — divergence turns it into two half-products.
**Status:** in effect. Carve-out for outside contributors only. See `parity.md`.

### 2026-09-07 — Local-first, no cloud dependency for the free tier

**Decision:** every surface reads/writes one local `~/.fungible/` libsql DB. Free tier has no server component; it rides Plaid's free developer tier with BYOK Plaid and LLM keys.
**Why:** privacy, zero hosting cost, instant reads, works offline. It's the core of the thesis.
**Status:** in effect.
