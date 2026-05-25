<img src="logo.png" alt="fungible" width="400" />

[![CI](https://github.com/tomfunk/fungible/actions/workflows/ci.yml/badge.svg)](https://github.com/tomfunk/fungible/actions/workflows/ci.yml)

A terminal UI for personal finance. Syncs transactions from Plaid, imports CSVs, and lets you categorize, search, tag, and analyze spending — all from the keyboard.

## Features

- **Plaid sync** — connect bank accounts and pull transactions automatically; 15-min debounce with force-sync option
- **CSV import** — import statement exports from any bank with flexible column mapping
- **Manual assets** — track a house, car, or other asset by name and value
- **Category rules** — substring and regex rules that auto-categorize transactions, with optional amount filters
- **Name rules** — rename how transactions display, with optional amount filters
- **Spending flexibility** — tag categories as fixed / flexible / discretionary; view breakdown on Dashboard
- **Manual edits** — pin a category or display name to a specific transaction; survives re-syncs
- **Ignore** — soft-hide transactions from totals (transfers, reimbursements, etc.)
- **Hidden categories** — exclude categories like Transfer from all totals and charts
- **Tags** — label transactions across accounts (trips, projects, events) and view summaries by tag
- **Net worth** — balance history with asset/liability breakdown; view by account or by type
- **Financial health** — cash and liquid runway, FIRE number and progress, years to retirement with adjustable assumptions
- **Dedup review** — review and remove CSV transactions that duplicate Plaid imports
- **Time ranges** — view Dashboard by week, month, quarter, year, or all time
- **Trends** — month-by-month bar charts for expenses, income, net, or any category; per-range aggregation
- **MCP server** — Claude can read and manage your finances via the Model Context Protocol

## Install

### Homebrew (recommended)

```bash
brew tap tomfunk/fungible
brew install fungible
fungible --setup   # first-time setup wizard
fungible
```

### From source

Requires Node.js 22+.

```bash
npm install
npm run dev
```

On first run, use `--setup` to configure credentials:

```bash
npm run dev -- --setup
```

Data and config are stored at `~/.fungible/`. Plaid access tokens are encrypted at rest using a key file at `~/.fungible/key` — do not delete this file or you will need to re-link your bank accounts. You'll need a free [Plaid](https://plaid.com) developer account to sync bank transactions (sandbox tier works).

## Screens

| Key | Screen |
|-----|--------|
| `1` | Dashboard |
| `2` | Transactions |
| `3` | Trends |
| `4` | Net Worth |
| `5` | Tags |
| `6` | Financial Health |
| `7` | Rules |
| `8` | Accounts |
| `q` | Quit |
| `Esc` | Back / clear filter |

## Key bindings

### Dashboard `[1]`

| Key | Action |
|-----|--------|
| `r` | Cycle time range (Week → Month → Quarter → Year → All Time) |
| `← →` | Previous / next period |
| `Tab` | Cycle views: Categories → Flex → Account picker |
| `↑ ↓` | Select category (Categories view) or account (Account view) |
| `Enter` | Drill into transactions for selected category / account |
| `Space` | Toggle account filter (Account view) |
| `c` | Clear account filter |

In **Categories** view, spending is broken down by category with bar charts. In **Flex** view, spending is grouped by flexibility tier (fixed / flexible / discretionary / untagged). In **Account** view, select an account to filter all dashboard data to that account.

### Transactions `[2]`

| Key | Action |
|-----|--------|
| `↑ ↓` | Navigate |
| `← →` | Previous / next month (when date filter active) |
| `Tab` | Cycle sort: Date ↓↑ → Description ↑↓ → Amount ↓↑ → Category ↑↓ |
| `/` | Search by name |
| `a` | Show all transactions |
| `u` | Show uncategorized only |
| `e` | Edit: rename display name or change category |
| `g` | Tag panel: add/remove tags on selected transaction |
| `G` | Tag all visible transactions at once (use `/` to filter first) |
| `x` | Undo manual category override |
| `i` | Ignore / un-ignore selected transaction |
| `d` | Delete selected transaction (CSV-imported only) |
| `Esc` | Clear active filter (peels off one at a time) |

### Trends `[3]`

| Key | Action |
|-----|--------|
| `← →` | Cycle views: Expenses → Income → Net → [each category] |
| `↑ ↓` | Navigate periods |
| `r` | Cycle aggregation range (Week / Month / Quarter / Year) |
| `Enter` | Drill into transactions for selected period |

### Net Worth `[4]`

| Key | Action |
|-----|--------|
| `Tab` | Toggle: by account ↔ by type |

Shows assets (depository, investment, manual), liabilities (credit), and net worth. History chart shows net worth trend over time.

### Tags `[5]`

| Key | Action |
|-----|--------|
| `↑ ↓` | Select tag |
| `/` | Search tags |
| `Enter` | Open tag detail (income / expenses / category breakdown) |
| `t` | View all transactions for selected tag |
| `a` | Add new tag |
| `r` | Rename selected tag |
| `d` | Delete selected tag |

In tag detail, `↑ ↓` selects a category and `Enter` drills into transactions for that tag + category. `← →` cycles to the previous/next tag.

### Financial Health `[6]`

Displays a full financial picture across four sections:

- **Snapshot** — savings rate (color-coded) and estimated monthly income
- **Runway** — months of cash and liquid coverage at current spending
- **Debt** — net cash position (checking minus credit debt), months to debt-free at current savings rate (hidden if no debt)
- **Retirement** — net worth, FIRE number with progress bar, Coast FIRE (years until growth alone covers retirement if you stop saving now), estimated years to FIRE

| Key | Action |
|-----|--------|
| `↑ ↓` | Select assumption dial |
| `← →` | Adjust selected dial value |
| `r` | Reset selected dial to default |

**Dials:** Monthly spending (±$100, default = avg past 12 months), Monthly savings (±$100, default = avg surplus), Withdrawal rate (±0.5%, default = 4%), Growth rate (±1%, default = 7%).

Liquid assets = cash + brokerage (excludes 401k, IRA, pension).

### Rules `[7]`

Three sections, cycle with `Tab`: **Category Rules**, **Name Rules**, **Categories**.

**Category Rules / Name Rules:**

| Key | Action |
|-----|--------|
| `/` | Search rules |
| `a` | Add rule |
| `e` / `Enter` | Edit selected rule |
| `d` | Delete selected rule |

Category rules support substring and regex matching with optional min/max amount filters. Name rules support the same matching plus optional amount filters.

**Categories:**

| Key | Action |
|-----|--------|
| `a` | Add new category |
| `r` | Rename category (cascades to all transactions, rules, and hidden settings) |
| `d` | Delete category (resets affected transactions to Uncategorized) |
| `h` | Toggle hidden (hidden categories are excluded from totals) |
| `f` | Cycle flexibility tier: none → fixed → flexible → discretionary |

### Accounts `[8]`

| Key | Action |
|-----|--------|
| `Tab` | Cycle views: Accounts → Add Data → Dupes |
| `↑ ↓` | Select account |
| `e` | Edit account type / subtype |
| `n` | Set or clear a nickname (shown in place of the bank-assigned name) |
| `v` | Update value (manual assets only) |
| `r` | Repair Plaid link for selected account |
| `s` | Force sync (bypasses 15-min cooldown) |
| `l` | Link a new bank account via Plaid |

**Add Data** options: `[l]` link bank via Plaid, `[c]` import CSV, `[m]` add manual asset (house, car, etc.), `[s]` force sync.

**Dupes** tab shows CSV transactions that match Plaid imports. `[d]` deletes the selected CSV duplicate; `[D]` deletes all.

## Scripts

```bash
# Link a new bank account via Plaid (also available from Accounts screen)
npm run link

# Import a CSV file
npm run import-csv /path/to/file.csv

# Seed default category rules
npm run seed-rules
```

## MCP Server

Exposes your financial data to Claude via the [Model Context Protocol](https://modelcontextprotocol.io).

```bash
npm run mcp
```

Available tools: `spending_summary`, `list_transactions`, `edit_transaction`, `clear_edit`, `ignore_transaction`, `list_rules`, `add_rule`, `delete_rule`, `list_name_rules`, `add_name_rule`, `delete_name_rule`, `list_hidden_categories`, `toggle_hidden_category`, `list_accounts`, `sync`, `uncategorized_summary`, `list_tags`, `tag_summary`, `tag_transaction`.

Add to your Claude config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

**If installed via Homebrew:**
```json
{
  "mcpServers": {
    "fungible": {
      "command": "/opt/homebrew/bin/node",
      "args": ["--experimental-sqlite", "--no-warnings", "--import", "tsx/esm", "/opt/homebrew/lib/node_modules/fungible/mcp/server.ts"]
    }
  }
}
```

**If running from source:**
```json
{
  "mcpServers": {
    "fungible": {
      "command": "node",
      "args": ["--experimental-sqlite", "--no-warnings", "--import", "tsx/esm", "/path/to/fungible/mcp/server.ts"]
    }
  }
}
```
