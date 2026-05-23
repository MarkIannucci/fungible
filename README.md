# fungible

A terminal UI for personal finance. Syncs transactions from Plaid, imports CSVs, and lets you categorize, search, tag, and analyze spending — all from the keyboard.

## Features

- **Plaid sync** — connect bank accounts and pull transactions automatically on startup
- **CSV import** — import statement exports from Capital One and other banks
- **Category rules** — substring and regex rules that auto-categorize transactions, with optional amount filters
- **Name rules** — rename how transactions display without affecting rule matching
- **Manual edits** — pin a category to a specific transaction; survives re-syncs
- **Ignore** — soft-hide transactions from totals (transfers, reimbursements, etc.)
- **Hidden categories** — exclude categories like Transfer from all totals/charts
- **Tags** — label transactions across accounts (trips, projects, events) and view summaries by tag
- **Time ranges** — view Dashboard by week, month, quarter, year, or all time
- **Trends** — month-by-month bar charts for expenses, income, net, or any category
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

## Key bindings

### Global
| Key | Action |
|-----|--------|
| `q` | Quit |
| `1` | Dashboard |
| `2` | Transactions |
| `3` | Rules |
| `4` | Import |
| `5` | Tags |
| `Esc` | Back / clear filter |

### Dashboard
| Key | Action |
|-----|--------|
| `r` | Cycle time range (Week → Month → Quarter → Year → All Time) |
| `← →` | Previous / next period |
| `↑ ↓` | Select category |
| `Enter` | View transactions for selected category + period |
| `t` | Trends (for selected category, or overall) |

### Tags
| Key | Action |
|-----|--------|
| `↑ ↓` | Select tag |
| `Enter` | Open tag detail (income / expenses / category breakdown) |
| `t` | View all transactions for selected tag |
| `a` | Add new tag |
| `d` | Delete selected tag |
| `Esc` | Back to list |

In tag detail view, `↑ ↓` selects a category and `Enter` drills into transactions for that tag + category. `← →` cycles to the previous/next tag.

### Transactions
| Key | Action |
|-----|--------|
| `↑ ↓` | Navigate |
| `← →` | Previous / next month (when date filter is active) |
| `/` | Search by name |
| `a` | Show all transactions |
| `u` | Show uncategorized only |
| `e` | Edit: rename display name or change category |
| `g` | Tag panel: add/remove tags on selected transaction |
| `x` | Undo manual category edit |
| `i` | Ignore / un-ignore selected transaction |

### Trends
| Key | Action |
|-----|--------|
| `← →` | Cycle views: Expenses → Income → Net → [each category] |
| `↑ ↓` | Navigate months |
| `Enter` | Drill into transactions for selected month |

### Rules
| Key | Action |
|-----|--------|
| `← →` | Switch between Category Rules / Name Rules / Hidden |
| `/` | Search rules |
| `a` | Add rule |
| `e` / `Enter` | Edit selected rule |
| `d` | Delete selected rule |

## Scripts

```bash
# Link a new bank account via Plaid (also available from the Import screen)
npm run link

# Import CSV files from a directory
npm run import-csv /path/to/csv/folder

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
