# TUI / GUI parity contract

Purpose: define what "parity" means between the terminal UI and the desktop app, and how it's enforced.

## What parity means

Same **concepts**, same **data**, same **outcome of a journey**. It does **not** mean same layout. Interaction idioms are native to each surface — keyboard-driven lists and single-key toggles in the TUI, pointer + panels in the GUI. Canvas renders as structured text in the TUI and as an interactive dial UI in the GUI; both compute the same outputs from the same spec.

## Must match

- **Screens exist on both.** All 10 (see [`screens.md`](screens.md)). Neither surface gets a screen the other lacks.
- **Same filters and ranges.** The shared `RANGES` (`week / month / last30 / quarter / year / alltime`) and the shared filter panel (categories / accounts / owners / tags) are defined once in `core/` and both surfaces consume them. A new filter dimension lands in `core/` or it lands nowhere.
- **Same vocabulary.** Screen names, metric names, button/hint labels use the terms in [`definitions.md`](definitions.md). "Scorecard" not "delta mode" on one and "insights" on the other.
- **Same empty and error states.** "No accounts yet — run `--setup`", "Scorecard not available for All Time", a failed sync — both surfaces say the same thing and offer the same next step.
- **Same numbers.** Any metric is computed in `core/` (or from a shared pure helper like `account-class.ts` / `canvas-spec.ts`), never re-derived per surface. If the GUI recomputes FIRE client-side, it uses the same formula module the TUI does.

## May differ

- Visual layout, spacing, column vs. card presentation, charts vs. ASCII bars.
- Input mechanics: arrow-key row selection vs. click; `[s]` toggle vs. a pill button.
- Progressive disclosure: the GUI can show more at once; the TUI can page.

## Known drift risk

The GUI has historically lagged the TUI — new range options, new toggles, and scorecard refinements shipped in the TUI first. The mitigation already in place: ranges, filter options, drift windows, and account classification are single-sourced in `core/`. The remaining risk is per-screen labels, hints, and empty states, which are still written twice.

## The rule

Any PR that touches a user-facing surface is checked against this doc at merge. The "parity not required" carve-out is for **outside contributors only** — a drive-by fix to one surface won't be blocked for lack of the matching change. Maintainer work keeps parity by default.
