# Definitions

Purpose: the canonical glossary and metric definitions. Every surface, the agent, and canvas must use these terms with these meanings. Where a term is used loosely today, that's called out as **[loose]**.

## Sign convention

Positive `amount` = money **out** (expense). Negative `amount` = money **in** (income). This is inverted from what people expect; the agent and canvas prompts state it explicitly.

## Income vs. expense vs. transfer

Totals are computed per category from summed outflow (`amount > 0`) and inflow (`amount < 0`), then:

- **Real categories are netted.** A refund or reimbursement sitting in an expense category *reduces* that category's spend. It does not add to income.
- **`Uncategorized` is split by flow, never netted.** Its outflows count as spending, its inflows as income. An un-ruled paycheck landing there can't erase the uncategorized spending total.
- **Excluded from every total and chart:** `pending = 1`, `ignored = 1`, the `Transfer` category, and anything in `hidden_categories`.
- **`ignored`** soft-hides a single transaction (transfers between your own accounts, reimbursements, card payments). **`hidden_categories`** hides a whole category everywhere.

Source: `summarizeBuckets` and `TRAILING_12MO_AVERAGES_SQL` in `core/queries.ts`.

## "A month" and the current incomplete period

There are **two** trailing-12 implementations and they intentionally do not agree. Settled 2026-09-15 (issue #178): both stay, disambiguated by label rather than reconciled to one formula — they serve different purposes and are expected to sit close but not identical. See `decisions.md`.

1. **"trailing 12mo"** — Health / runway / FIRE basis (`TRAILING_12MO_AVERAGES_SQL`, feeds the Financial Health screen and the agent's `get_financial_health`): a single SQL window, `date >= date('now', '-12 months')`, with the summed result divided by `12.0`. It is a **rolling 12-calendar-month window ÷ 12** — effectively "the prior ~365 days ÷ 12." The window starts partway through the month a year ago and ends partway through the current month, so the two partial months roughly cancel. It is a fair 12-month average, not systematically biased low. This is the basis for runway, FIRE number, and years-to-FIRE math below. Used by: the Health screen (caption text stays as-is — that screen only ever shows this basis, so there's no ambiguity to disambiguate) and canvas-agent prose.
2. **"12 complete periods"** — Dashboard scorecard / drift basis (`getDriftWindows` in `core/dateUtils.ts`): the **current period** runs `from` → `effectiveTo`, where `effectiveTo = min(period end, today)` — a partial month is compared partial-to-partial. The baseline is **12 complete prior periods**, each capped to the same number of elapsed days as the current period — a fair same-point-in-period comparison, which is what category-drift detection needs. Combined with the existing "typical month" mode name, the full label is **"vs typical month (12 complete periods)."** Used by: the Dashboard scorecard header/column text, drift computations, and the `get_scorecard` tool output.

Neither is more "correct" than the other — trailing 12mo smooths for long-range planning math (runway/FIRE), 12 complete periods gives a fair same-point-in-period comparison for spotting this month's drift. The only formula difference: scorecard aligns to calendar-month boundaries (current month = 1st → today, baseline = 12 complete prior months clipped to elapsed days), while Health uses an unaligned rolling ~365-day span. Every screen, tool, and agent utterance stating either figure must carry its label — see `agent-behavior.md`'s prose-reconciliation rule. Implementation: `basis`/`basisLabel` fields on `HealthData`, `FinancialHealth`, and `DriftSlice`, sourced from a shared label map in `core/dateUtils.ts`.

## Balance buckets

From `core/health.ts` and `core/agent-context.ts` (`getBalances`). All use each account's most recent `balance_history` snapshot and exclude accounts with `excluded = 1`.

| Term | Definition |
|------|-----------|
| **cash** | `depository` accounts only (checking, savings). |
| **liquid** | cash + `investment` accounts whose subtype is `brokerage`, `cash isa`, or `non-taxable brokerage account`. This is the canonical term. `core/agent-context.ts` currently calls the same figure "accessible" / "total accessible" and should be changed to say **liquid** — tracked as a core follow-up. |
| **retirement** | `investment` accounts with subtype `ira`, `401k`, `roth`, `403b`, `457b`, `hsa`, `roth 401k`, `simple ira`, `sep ira`, or `pension`. Restricted until ~59½. |
| **totalDebt** | `credit` accounts (credit cards). |
| **loanDebt** | `loan` accounts (mortgage, auto, student). |
| **net worth** | (`depository` + `investment` + `other`, positive balances) − (`credit` + `loan`). Loan balances (mortgage, auto, student) are subtracted as liabilities. FIRE progress therefore reflects loan debt: someone paying down a mortgage sees FIRE progress rise as the balance falls. To net a house out, add it as a manual asset or don't link the mortgage. |

`core/agent-context.ts` lists account types as "depository, investment, credit, other" — it omits `loan`, which is real. **[stale]**

## Spending flexibility

Each category carries an optional `flexibility` tag: `fixed`, `flexible`, or `discretionary`. Untagged spend (including all `Uncategorized`) falls in an `untagged` bucket. Shown on the Dashboard flex view and in scorecard mode. Source: `queryFlexTotals` in `core/queries.ts`.

- **fixed** — you can't move it this month (rent, insurance, loan payments).
- **flexible** — recurring but adjustable (groceries, utilities).
- **discretionary** — optional (dining, entertainment, shopping).

## Runway

- **cash runway** = cash / trailing-12-month avg monthly expenses.
- **liquid runway** = liquid / trailing-12-month avg monthly expenses.

Months of expenses your balances cover. Uses trailing-12 definition #1 above.

## FIRE number and progress

From `getFinancialHealth` in `core/agent-context.ts`; the Health screens recompute the same formulas client-side with adjustable dials.

- **FIRE number** = (trailing-12 avg monthly expenses × 12) / withdrawal rate. Default withdrawal rate 4%.
- **FIRE progress** = max(0, net worth) / FIRE number, as a 0–1 ratio.
- **years to FIRE** = time-value-of-money solve: present value = net worth, future value = FIRE number, monthly payment = avg monthly savings + pretax monthly, rate = annual growth (default 7%). `null` if > 100 years.
- **coast years** = years for net worth alone (no further contributions) to compound to the FIRE number at the growth rate.
- **pretax monthly** is a manual Settings value (401k / HSA never appear in transactions). It's added to both savings and gross income in the FIRE and savings-rate math.

## Savings rate

- **On the Health screens and in `get_financial_health`:** (avg monthly savings + pretax monthly) / (avg monthly take-home income + pretax monthly) × 100.
- **The raw `HealthData.savingsRate` field** (`loadHealthData`) is transactions-only — no pretax — and is **not** what the screens display. **[loose]** — don't cite this field.

## Scorecard mode (Dashboard)

Per-category and per-flex-tier spending compared against three baselines:

1. **prior period** (`lastPeriodDelta`)
2. **same period last year** (`lastYearDelta`)
3. **12-period baseline** — both the mean (`avg12m`) and the **median** (`median12m`) are computed. The verdict (OVER / TYPICAL / UNDER) and the heat-map coloring use the **median**, which is robust to one-off spikes. The detail-columns view (`[x]`) shows the prior-period and last-year deltas side by side.

`docs/keybindings.md` calls this "delta mode" bound to `d`; the code calls it "scorecard" bound to `s`. **[stale doc]** — keybindings.md needs fixing.
