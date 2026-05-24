# fungible

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

## Requirements

- Node.js 22+ (uses built-in `node:sqlite`)
- A [Plaid](https://plaid.com) developer account (free sandbox/development tier works)

## Setup

```bash
npm install
```

Create a `.env` file:

```
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=development
```

## Running

```bash
npm run dev
```

Data is stored at `~/.fungible/fungible.db`.

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
| `x` | Undo manual category override |
| `i` | Ignore / un-ignore selected transaction |
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
| `d` | Delete selected tag |

In tag detail, `↑ ↓` selects a category and `Enter` drills into transactions for that tag + category. `← →` cycles to the previous/next tag.

### Financial Health `[6]`

Displays cash runway, liquid runway, net worth, FIRE number with progress, and estimated years to retirement.

| Key | Action |
|-----|--------|
| `↑ ↓` | Select assumption dial |
| `← →` | Adjust selected dial value |
| `r` | Reset selected dial to default |

**Dials:** Monthly spending (±$100, default = avg past 12 months), Monthly savings (±$100, default = avg surplus), Withdrawal rate (±0.5%, default = 4%), Growth rate (±1%, default = 7%).

Liquid assets = cash + brokerage (excludes 401k, IRA, pension).

### Rules `[7]`

| Key | Action |
|-----|--------|
| `Tab` | Switch between Category Rules / Name Rules / Hidden Categories |
| `/` | Search rules |
| `a` | Add rule |
| `e` / `Enter` | Edit selected rule |
| `d` | Delete selected rule |

Category rules support substring and regex matching with optional min/max amount filters. Name rules support the same matching plus optional amount filters.

### Accounts `[8]`

| Key | Action |
|-----|--------|
| `Tab` | Cycle views: Accounts → Add Data → Dupes |
| `↑ ↓` | Select account |
| `e` | Edit account type / subtype |
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
