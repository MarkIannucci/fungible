# Product docs — `docs/product/`

Purpose: the specs that keep fungible coherent across the TUI, GUI, MCP/agent, and canvas surfaces. Not user docs — reference for contributors and for the planning process.

## What lives here

| File | What it is |
|------|-----------|
| [`thesis.md`](thesis.md) | The product thesis, pillars, non-goals, and target user. |
| [`definitions.md`](definitions.md) | Canonical glossary and metric definitions. The single source every surface, the agent, and canvas must cite. |
| [`parity.md`](parity.md) | The TUI/GUI parity contract — what must match, what may differ. |
| [`canvas-scope.md`](canvas-scope.md) | What canvas is for, its component model, and the open question about dynamic lists. |
| [`agent-behavior.md`](agent-behavior.md) | Behavior spec for the in-app agent and the MCP surface. |
| [`journeys.md`](journeys.md) | The key end-to-end journeys and where each one breaks today. |
| [`screens.md`](screens.md) | The 10-screen inventory — the anti-sprawl reference. |
| [`decisions.md`](decisions.md) | Decision log, newest first. |

## How these docs are used

- **Consulted during planning on anything user-facing.** The planning step names the concept, says which journey it serves, and checks it against `thesis.md` and `screens.md` before code is written. A feature with no home on an existing screen, or that duplicates a term already defined here, gets flagged then.
- **Reviews cross-surface work at merge for drift.** Any PR that touches more than one surface is checked against `parity.md` and `definitions.md`. Same concept, same vocabulary, same numbers.
- **Kept current.** These docs are updated when a decision is made or a definition tightens.
- **Reference only.** These docs hold no code. Implementation lives in the TUI, GUI, and core.
