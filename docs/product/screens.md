# Screen inventory

Purpose: the 10 screens, what each is for, and what deliberately stays off it. The anti-sprawl reference — a new feature has to land on one of these or justify an eleventh.

All 10 exist on both the TUI and the GUI (see [`parity.md`](parity.md)). Number = the key that jumps to it.

| # | Screen | Purpose | Belongs here | Deliberately not here |
|---|--------|---------|--------------|-----------------------|
| 0 | **Settings** | App configuration. | Plaid/LLM key status, pretax-monthly value, backup settings, data dir. | Financial assumptions that belong to a screen (withdrawal rate lives on Health). |
| 1 | **Dashboard** | This period's spending. | Spending by category with bars; flex view (fixed/flexible/discretionary); scorecard mode (`[s]`); account picker; regex search. | Month-over-month history (that's Trends); balances (that's Net Worth). |
| 2 | **Transactions** | The transaction list. | Sort, regex search, date filter, drill-down from Dashboard, inline recategorize / tag / ignore / reattribute date. | Aggregates and charts — it's a list. |
| 3 | **Trends** | Spending over time. | Month/quarter/week/year bars for expenses, income, net, or a single category; per-range aggregation. | Single-period category breakdown (Dashboard). |
| 4 | **Net Worth** | Balances and their history. | Assets, liabilities, net worth, balance-history chart; by account or by type; manual assets. | Runway and FIRE (those interpret net worth — that's Health). |
| 5 | **Tags** | Cross-account labels. | Create/apply tags (trips, projects, events); per-tag income/expense/net and category breakdown. | Category rules — tags are manual/ad-hoc grouping. |
| 6 | **Financial Health** | The FIRE dashboard. | Cash + liquid runway; FIRE number, progress, years to retirement, coast years; adjustable withdrawal rate, growth, spend, savings, pretax dials; savings rate. | Raw balances (Net Worth); the priority-waterfall text (that's the agent + `finance-guide.ts`). |
| 7 | **Rules** | Automated categorization. | Category rules, name rules, tag rules (three Tab sections), hidden categories; substring or regex, optional amount bounds. | Manual one-off category overrides — those happen on Transactions. |
| 8 | **Accounts** | Connections and imports. | Linked Plaid items, CSV import with column mapping, manual assets, dedup review, per-item sync status. | Balances over time (Net Worth). |
| 9 | **Canvas** | Saved calculators. | List, open, and delete agent-generated canvases; adjust dials, read outputs. | Anything that isn't a single-scenario dial-and-output calculator — see [`canvas-scope.md`](canvas-scope.md). |

## Adding an 11th screen

Justify it against this table first. Most new ideas are a section on an existing screen or a canvas. A new screen is warranted only when the concept is a distinct recurring destination that doesn't fit any row above and would bloat one if forced in.
