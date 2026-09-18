# Product thesis

Purpose: what fungible is, what it refuses to be, and who it's for.

## Thesis

fungible is a local-first, keyboard-first replacement for Mint / Monarch that already knows your numbers. It's built for people who **audit** their spending rather than budget it, with a FIRE lean, and an LLM layer — the in-app agent, canvas, and MCP server — that reasons over your real data so you never re-key numbers into a web calculator.

## Pillars

1. **Local-first.** Every surface reads and writes one libsql database at `~/.fungible/` (override with `$FUNGIBLE_DATA_DIR`). It's free because it rides Plaid's free developer tier; you bring your own Plaid and LLM keys.
2. **TUI ⇄ GUI parity, one engine.** `core/` holds all the logic; the TUI (Ink) and GUI (Electron) are thin views over it. A web app someday is a version of the GUI, not a new codebase. No mobile. See [`parity.md`](parity.md).
3. **Audit, not budgeting.** There is no budget feature, deliberately. The spending model is fixed / flexible / discretionary tagging plus scorecard mode (per-category deltas vs. prior period, same period last year, and a 12-month baseline). See [`definitions.md`](definitions.md).
4. **FIRE tilt.** The Financial Health screen is runway + FIRE number + years-to-retirement. Advice follows the opinionated priority waterfall baked into `core/finance-guide.ts`.
5. **The LLM layer is the "reason about MY situation" surface.** The agent reads your data, navigates the app, and runs write tools with confirmation. Canvas is the catch-all for calculators, so the core screens don't sprawl. MCP exposes the same tools to Claude Desktop and scripts.

## Non-goals

- Envelope / zero-based / any budgeting feature.
- A mobile app.
- Being a FIRE calculator for people who just want spending visibility.
- A paid tier in the near term. If it ever happens: a hosted web app whose subscription covers Plaid plus a little agent LLM spend, via the mycelium backend. Willingness to pay is unproven — this is deferred, not planned.

## Target user

Technical, comfortable in a terminal, already tracks net worth, dislikes budgeting. The primary dogfooder is FIRE-minded with a large taxable brokerage and young kids — which is why "accessible now vs. restricted until ~59½" and household-aware canvas prompts matter.
