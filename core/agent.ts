/**
 * Agent core — runs the agentic loop using the detected LLM provider.
 * Handles tool execution, confirmation for write operations, and UI navigation.
 */

import 'dotenv/config';
import { streamResponse, makeAssistantMessage, detectProvider, getProviderModel } from './llm-provider.js';
import type { Message, ContentBlock, ToolDef } from './llm-provider.js';
import { APP_CONTEXT, getBalances, getFinancialHealth, getSpendingTrends } from './agent-context.js';
import { getFinanceGuide, getFinanceTopicList, formatGuideSection, type GuideTopic } from './finance-guide.js';
import { getRangeSummary, getMonthlySummary, getTagSummary } from './queries.js';
import { categorize } from './categorize.js';
import { rebuildDisplayNames } from './rename.js';
import { syncAll } from './sync.js';
import { db } from './db.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Constants ────────────────────────────────────────────────────────────────

const WRITE_TOOLS = new Set([
  'edit_transaction', 'clear_edit', 'ignore_transaction',
  'add_rule', 'delete_rule', 'add_name_rule', 'delete_name_rule',
  'tag_transaction', 'toggle_hidden_category', 'sync',
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentCallbacks = {
  /** Called for each streaming text chunk. */
  onText: (delta: string) => void;
  /** Called when the agent starts executing a tool. */
  onToolCall: (name: string, humanDesc: string) => void;
  /** Called when a write tool needs confirmation. Resolves true = proceed. */
  onConfirm: (humanDesc: string) => Promise<boolean>;
  /** Called by the `show` tool to navigate the UI. */
  onNavigate: (screen: string, filter?: Record<string, string>) => void;
};

// ─── System prompt ────────────────────────────────────────────────────────────

function loadReadme(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    return fs.readFileSync(path.join(dir, '..', 'README.md'), 'utf8');
  } catch {
    return '';
  }
}

function buildSystemPrompt(): string {
  const provider = (() => { try { return detectProvider(); } catch { return 'unknown'; } })();
  const model    = (() => { try { return getProviderModel(provider as 'anthropic' | 'openai'); } catch { return ''; } })();

  return `You are a personal finance assistant embedded in fungible, a terminal-based personal finance app.
You run inside the app itself — you can read the user's financial data, take actions on their behalf (with confirmation), and navigate the app UI to show them relevant views.

${APP_CONTEXT}

## Personal Finance Philosophy

Follow this priority waterfall — do steps in order:
1. Employer 401k match — always capture the full match first (it's a guaranteed 50–100% return)
2. High-interest debt (>6–7%) — eliminate before investing; guaranteed return beats the market
3. Emergency fund (3–6 months expenses) — HYSA only, not invested
4. HSA — triple tax advantage if you have an HDHP; max it and invest the balance
5. IRA — Roth if income allows ($7k/yr limit); Traditional or Backdoor Roth otherwise
6. 401k beyond match — max it ($23k/yr limit); pick lowest-expense index funds
7. Medium-interest debt (3–6%) — judgment call vs investing
8. Taxable investing — total-market index funds, low cost
9. Low-interest debt (<3%) — mathematically better to invest; pay if it bothers you

Use \`get_finance_guide\` for detailed guidance on any topic.

## Behavior
- Proactively fetch relevant data before answering financial questions — don't answer blind
- Use the \`show\` tool to navigate the app to the most relevant screen when it helps understanding
- Be concise. Use numbers from actual data rather than generalities.
- For write operations, be specific about exactly what will change before asking confirmation
- When the user asks about their situation, compare it to the priority waterfall and give actionable advice

Model in use: ${model}
`.trim();
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOL_DEFS: ToolDef[] = [
  // ── Data / read ────────────────────────────────────────────────────────────

  {
    name: 'spending_summary',
    description: 'Get income, expenses, net, and spending by category. Provide either (year + month) for a specific month, or (from + to) for a date range.',
    parameters: {
      type: 'object',
      properties: {
        year:  { type: 'integer', description: '4-digit year' },
        month: { type: 'integer', description: 'Month 1–12', minimum: 1, maximum: 12 },
        from:  { type: 'string',  description: 'Start date YYYY-MM-DD' },
        to:    { type: 'string',  description: 'End date YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'list_transactions',
    description: 'List transactions with optional filters. Returns date, name, amount, category, account, and ID.',
    parameters: {
      type: 'object',
      properties: {
        category:        { type: 'string',  description: 'Filter by category name' },
        year:            { type: 'integer', description: '4-digit year (use with month)' },
        month:           { type: 'integer', description: 'Month 1–12 (use with year)', minimum: 1, maximum: 12 },
        from:            { type: 'string',  description: 'Start date YYYY-MM-DD' },
        to:              { type: 'string',  description: 'End date YYYY-MM-DD' },
        search:          { type: 'string',  description: 'Search within transaction name' },
        include_ignored: { type: 'boolean', description: 'Include ignored transactions (default false)' },
        limit:           { type: 'integer', description: 'Max results (default 50)', minimum: 1, maximum: 500 },
      },
    },
  },
  {
    name: 'list_accounts',
    description: 'List all connected accounts (banks, credit cards, manual assets).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_balances',
    description: 'Get current balances for all accounts, plus net worth, total cash, and total liquid assets.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_financial_health',
    description: 'Get financial health metrics: cash and liquid runway months, FIRE number, progress, and estimated years to retirement.',
    parameters: {
      type: 'object',
      properties: {
        withdrawal_rate: { type: 'number', description: 'Safe withdrawal rate % (default 4)', minimum: 0.5, maximum: 10 },
        growth_rate:     { type: 'number', description: 'Expected annual growth rate % (default 7)', minimum: 0, maximum: 20 },
      },
    },
  },
  {
    name: 'get_trends',
    description: 'Month-by-month spending trends for the last N months. Optionally filter to a specific category.',
    parameters: {
      type: 'object',
      properties: {
        months:   { type: 'integer', description: 'Months to look back (default 12)', minimum: 1, maximum: 60 },
        category: { type: 'string',  description: 'Category name to track (omit for overall)' },
      },
    },
  },
  {
    name: 'list_rules',
    description: 'List all category rules.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_name_rules',
    description: 'List all name rules (rules that rename transaction display names).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_hidden_categories',
    description: 'List categories hidden from totals and charts.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_tags',
    description: 'List all tags with transaction counts.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'tag_summary',
    description: 'Get income, expenses, net, and category breakdown for all transactions with a given tag.',
    parameters: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag name' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'uncategorized_summary',
    description: 'Show the most common uncategorized transaction names, useful for writing new rules.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max results (default 30)', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'get_finance_guide',
    description: 'Get opinionated personal finance guidance. Omit topic for an overview; provide a topic for detailed advice.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Topic to retrieve',
          enum: ['priorities', 'emergency-fund', 'debt', 'employer-match', 'hsa', 'ira', '401k', 'investing', 'budgeting', 'fire', 'housing', 'car', 'insurance'],
        },
      },
    },
  },

  // ── Write (require confirmation) ───────────────────────────────────────────

  {
    name: 'edit_transaction',
    description: 'Manually set the category for a specific transaction (pins it — survives re-syncs). Use list_transactions to get the ID.',
    parameters: {
      type: 'object',
      properties: {
        id:       { type: 'string', description: 'Transaction ID' },
        category: { type: 'string', description: 'Category to assign' },
      },
      required: ['id', 'category'],
    },
  },
  {
    name: 'clear_edit',
    description: 'Remove a manual category override from a transaction, reverting to rule-based categorization.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Transaction ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'ignore_transaction',
    description: 'Toggle the ignored flag on a transaction. Ignored transactions are hidden from totals and charts.',
    parameters: {
      type: 'object',
      properties: {
        id:     { type: 'string',  description: 'Transaction ID' },
        ignore: { type: 'boolean', description: 'true to ignore, false to un-ignore' },
      },
      required: ['id', 'ignore'],
    },
  },
  {
    name: 'add_rule',
    description: 'Add a category rule and immediately apply it to all transactions.',
    parameters: {
      type: 'object',
      properties: {
        pattern:    { type: 'string', description: 'Text to match against transaction name' },
        match_type: { type: 'string', description: '"name" for substring, "regex" for regex', enum: ['name', 'regex'] },
        category:   { type: 'string', description: 'Category to assign' },
        priority:   { type: 'integer', description: 'Higher priority runs first (default 10)' },
        min_amount: { type: 'number', description: 'Minimum transaction amount (optional)' },
        max_amount: { type: 'number', description: 'Maximum transaction amount (optional)' },
      },
      required: ['pattern', 'match_type', 'category'],
    },
  },
  {
    name: 'delete_rule',
    description: 'Delete a category rule by ID. Use list_rules to find the ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Rule ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_name_rule',
    description: 'Add a name rule that renames how transactions display.',
    parameters: {
      type: 'object',
      properties: {
        pattern:     { type: 'string', description: 'Text or regex to match' },
        match_type:  { type: 'string', description: '"name" for substring, "regex" for regex', enum: ['name', 'regex'] },
        replacement: { type: 'string', description: 'Display name to show instead' },
        min_amount:  { type: 'number', description: 'Minimum transaction amount (optional)' },
        max_amount:  { type: 'number', description: 'Maximum transaction amount (optional)' },
      },
      required: ['pattern', 'match_type', 'replacement'],
    },
  },
  {
    name: 'delete_name_rule',
    description: 'Delete a name rule by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Name rule ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tag_transaction',
    description: 'Add or remove a tag on a transaction.',
    parameters: {
      type: 'object',
      properties: {
        id:  { type: 'string',  description: 'Transaction ID' },
        tag: { type: 'string',  description: 'Tag name' },
        add: { type: 'boolean', description: 'true to add, false to remove' },
      },
      required: ['id', 'tag', 'add'],
    },
  },
  {
    name: 'toggle_hidden_category',
    description: 'Add or remove a category from the hidden list. Hidden categories are excluded from all totals.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string',  description: 'Category name' },
        hide:     { type: 'boolean', description: 'true to hide, false to unhide' },
      },
      required: ['category', 'hide'],
    },
  },
  {
    name: 'sync',
    description: 'Sync latest transactions from Plaid for all connected accounts.',
    parameters: { type: 'object', properties: {} },
  },

  // ── UI navigation ──────────────────────────────────────────────────────────

  {
    name: 'show',
    description: 'Navigate the app UI to display a specific screen or filtered view. Use this to show the user relevant data visually.',
    parameters: {
      type: 'object',
      properties: {
        screen:      { type: 'string', description: 'Screen to navigate to', enum: ['dashboard', 'transactions', 'trends', 'networth', 'tags', 'rules', 'accounts', 'health'] },
        category:    { type: 'string', description: 'Filter transactions by category' },
        from:        { type: 'string', description: 'Start date YYYY-MM-DD' },
        to:          { type: 'string', description: 'End date YYYY-MM-DD' },
        tag:         { type: 'string', description: 'Filter by tag' },
        account:     { type: 'string', description: 'Filter by account ID' },
        accountName: { type: 'string', description: 'Account display name (paired with account)' },
      },
      required: ['screen'],
    },
  },
];

// ─── Human-readable tool descriptions ────────────────────────────────────────

function describeToolCall(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => String(input[k] ?? '');
  const n = (k: string) => Number(input[k] ?? 0);
  switch (name) {
    case 'edit_transaction':       return `Set transaction category to "${s('category')}" [id: ${s('id')}]`;
    case 'clear_edit':             return `Remove manual category override [id: ${s('id')}]`;
    case 'ignore_transaction':     return `${input['ignore'] ? 'Ignore' : 'Un-ignore'} transaction [id: ${s('id')}]`;
    case 'add_rule':               return `Add category rule: "${s('pattern')}" → ${s('category')}`;
    case 'delete_rule':            return `Delete category rule #${n('id')}`;
    case 'add_name_rule':          return `Add name rule: "${s('pattern')}" → "${s('replacement')}"`;
    case 'delete_name_rule':       return `Delete name rule #${n('id')}`;
    case 'tag_transaction':        return `${input['add'] ? 'Add' : 'Remove'} tag #${s('tag')} on transaction [id: ${s('id')}]`;
    case 'toggle_hidden_category': return `${input['hide'] ? 'Hide' : 'Unhide'} category "${s('category')}"`;
    case 'sync':                   return 'Sync transactions from Plaid';
    default:                       return name;
  }
}

// ─── Tool executor ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  callbacks: AgentCallbacks,
): Promise<string> {

  // UI navigation — no confirmation needed
  if (name === 'show') {
    const { screen, ...rest } = input as Record<string, string>;
    const filter: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== null) filter[k] = String(v);
    }
    callbacks.onNavigate(screen, filter);
    const desc = Object.keys(filter).length
      ? `${screen} (${Object.entries(filter).map(([k, v]) => `${k}: ${v}`).join(', ')})`
      : screen;
    return `Navigated to ${desc}`;
  }

  // Write tools — confirm before executing
  if (WRITE_TOOLS.has(name)) {
    const confirmed = await callbacks.onConfirm(describeToolCall(name, input));
    if (!confirmed) return 'Cancelled.';
  }

  // Execute
  const str  = (k: string, def = '') => String(input[k] ?? def);
  const num  = (k: string, def = 0)  => Number(input[k] ?? def);
  const bool = (k: string)            => Boolean(input[k]);
  const opt  = (k: string)            => input[k] !== undefined ? Number(input[k]) : null;

  switch (name) {

    // ── Read tools ────────────────────────────────────────────────────────────

    case 'spending_summary': {
      const from = str('from'); const to = str('to');
      const year = num('year'); const month = num('month');
      let summary; let label: string;
      if (from && to) {
        summary = getRangeSummary(from, to);
        label = `${from} – ${to}`;
      } else if (year && month) {
        summary = getMonthlySummary(year, month);
        label = `${new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })} ${year}`;
      } else {
        return 'Provide either (year + month) or (from + to).';
      }
      const lines = [
        `## ${label}`,
        `Income: $${summary.income.toFixed(2)}`,
        `Expenses: $${summary.expenses.toFixed(2)}`,
        `Net: ${summary.net >= 0 ? '+' : ''}$${summary.net.toFixed(2)}`,
        '',
        'By category:',
        ...summary.byCategory.map((c) => `  ${c.category}: $${c.total.toFixed(2)}`),
      ];
      return lines.join('\n');
    }

    case 'list_transactions': {
      const conditions: string[] = ['t.pending = 0'];
      const args: (string | number)[] = [];
      if (!bool('include_ignored')) conditions.push('t.ignored = 0');
      if (input['category']) { conditions.push('t.category = ?'); args.push(str('category')); }
      if (input['from'] && input['to']) {
        conditions.push('t.date >= ? AND t.date <= ?'); args.push(str('from'), str('to'));
      } else if (input['month'] && input['year']) {
        const m = str('month').padStart(2, '0'); const y = str('year');
        conditions.push('t.date >= ? AND t.date <= ?');
        args.push(`${y}-${m}-01`, `${y}-${m}-31`);
      }
      if (input['search']) {
        conditions.push('(t.name LIKE ? OR t.display_name LIKE ?)');
        args.push(`%${str('search')}%`, `%${str('search')}%`);
      }
      const where = 'WHERE ' + conditions.join(' AND ');
      const limit = input['limit'] ? num('limit') : 50;
      const rows = db.prepare(`
        SELECT t.id, t.date, COALESCE(t.display_name, t.name) as name, t.amount,
               t.category, t.manual_category, t.ignored, a.name as account
        FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id
        ${where} ORDER BY t.date DESC LIMIT ?
      `).all(...args, limit) as { id: string; date: string; name: string; amount: number; category: string; manual_category: string | null; ignored: number; account: string }[];
      if (!rows.length) return 'No transactions found.';
      return rows.map((r) => {
        const sign = r.amount < 0 ? '+' : '-';
        const flags = (r.manual_category ? '◆' : ' ') + (r.ignored ? '~' : ' ');
        return `${r.date}  ${flags}  ${r.name.slice(0, 36).padEnd(36)}  ${sign}$${Math.abs(r.amount).toFixed(2).padStart(9)}  ${r.category}  [${r.id}]`;
      }).join('\n');
    }

    case 'list_accounts': {
      const rows = db.prepare('SELECT name, type, subtype, mask, institution_name FROM accounts').all() as { name: string; type: string; subtype: string; mask: string | null; institution_name: string | null }[];
      if (!rows.length) return 'No accounts connected.';
      return rows.map((a) => `${a.name} (${a.subtype ?? a.type}) ···${a.mask ?? '?'} — ${a.institution_name ?? 'Unknown'}`).join('\n');
    }

    case 'get_balances': {
      const b = getBalances();
      if (!b.accounts.length) return 'No balance data available. Sync accounts first.';
      const fmt = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const lines = [
        'Assets:',
        ...b.accounts.filter((a) => a.isAsset).map((a) => `  ${a.name}: ${fmt(a.balance)} (${a.subtype ?? a.type})`),
        `  Total assets: ${fmt(b.totalAssets)}`,
        'Liabilities:',
        ...b.accounts.filter((a) => a.isLiability).map((a) => `  ${a.name}: ${fmt(a.balance)}`),
        `  Total liabilities: ${fmt(b.totalLiabilities)}`,
        `Net worth: ${b.netWorth >= 0 ? '' : '-'}${fmt(b.netWorth)}`,
        `Cash (checking/savings): ${fmt(b.cash)}`,
        `Liquid (incl. brokerage): ${fmt(b.liquid)}`,
      ];
      return lines.join('\n');
    }

    case 'get_financial_health': {
      const h = getFinancialHealth(
        input['withdrawal_rate'] ? num('withdrawal_rate') : 4,
        input['growth_rate']     ? num('growth_rate')     : 7,
      );
      const fmt  = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      const fmtM = (n: number) => Number.isFinite(n) && n < 999 ? `${n.toFixed(1)} months` : '∞';
      return [
        `Net worth: ${h.netWorth >= 0 ? '' : '-'}${fmt(h.netWorth)}`,
        `Cash runway: ${fmtM(h.cashRunwayMonths)} (${fmt(h.cash)} in checking/savings)`,
        `Liquid runway: ${fmtM(h.liquidRunwayMonths)} (${fmt(h.liquid)} incl. brokerage)`,
        `Avg monthly expenses (12 mo): ${fmt(h.avgMonthlyExpenses)}`,
        `Avg monthly savings (12 mo): ${fmt(h.avgMonthlySavings)}`,
        `FIRE number: ${fmt(h.fireNumber)}`,
        `FIRE progress: ${(h.fireProgress * 100).toFixed(1)}%`,
        `Years to FIRE: ${h.yearsToFire === null ? '100+' : h.yearsToFire === 0 ? 'Achieved!' : `~${Math.ceil(h.yearsToFire)}`}`,
      ].join('\n');
    }

    case 'get_trends': {
      const rows = getSpendingTrends(input['months'] ? num('months') : 12, input['category'] ? str('category') : undefined);
      if (!rows.length) return 'No data.';
      const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      const header = input['category']
        ? `Month         ${str('category').padStart(12)}  Expenses      Income        Net`
        : 'Month         Expenses      Income        Net';
      const divider = '─'.repeat(header.length);
      const dataLines = rows.map((r) => {
        const base = `${r.label.padEnd(14)}${fmt(r.expenses).padStart(12)}  ${fmt(r.income).padStart(12)}  ${(r.net >= 0 ? '+' : '') + fmt(r.net)}`;
        return input['category']
          ? `${r.label.padEnd(14)}${fmt(r.categoryTotal ?? 0).padStart(12)}  ${fmt(r.expenses).padStart(12)}  ${fmt(r.income).padStart(12)}  ${(r.net >= 0 ? '+' : '') + fmt(r.net)}`
          : base;
      });
      return [header, divider, ...dataLines].join('\n');
    }

    case 'list_rules': {
      const rules = db.prepare(
        'SELECT id, priority, match_type, pattern, category, min_amount, max_amount FROM category_rules ORDER BY priority DESC, id ASC'
      ).all() as { id: number; priority: number; match_type: string; pattern: string; category: string; min_amount: number | null; max_amount: number | null }[];
      if (!rules.length) return 'No rules defined.';
      return rules.map((r) => {
        const amt = r.min_amount != null && r.max_amount != null
          ? ` [$${r.min_amount}–$${r.max_amount}]`
          : r.min_amount != null ? ` [≥$${r.min_amount}]`
          : r.max_amount != null ? ` [≤$${r.max_amount}]` : '';
        return `[${r.id}] pri=${r.priority} ${r.match_type.padEnd(5)} "${r.pattern}"${amt} → ${r.category}`;
      }).join('\n');
    }

    case 'list_name_rules': {
      const rules = db.prepare(
        'SELECT id, match_type, pattern, replacement, min_amount, max_amount FROM name_rules ORDER BY id ASC'
      ).all() as { id: number; match_type: string; pattern: string; replacement: string; min_amount: number | null; max_amount: number | null }[];
      if (!rules.length) return 'No name rules defined.';
      return rules.map((r) => {
        const amt = r.min_amount != null ? ` [≥$${r.min_amount}]` : r.max_amount != null ? ` [≤$${r.max_amount}]` : '';
        return `[${r.id}] ${r.match_type.padEnd(5)} "${r.pattern}"${amt} → "${r.replacement}"`;
      }).join('\n');
    }

    case 'list_hidden_categories': {
      const rows = db.prepare('SELECT category FROM hidden_categories ORDER BY category').all() as { category: string }[];
      return rows.length ? rows.map((r) => r.category).join('\n') : 'No hidden categories.';
    }

    case 'list_tags': {
      const rows = db.prepare(`
        SELECT t.name, COUNT(tt.transaction_id) as count
        FROM tags t LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
        GROUP BY t.id ORDER BY t.name
      `).all() as { name: string; count: number }[];
      return rows.length ? rows.map((r) => `${r.name.padEnd(30)} ${r.count} txn${r.count !== 1 ? 's' : ''}`).join('\n') : 'No tags defined.';
    }

    case 'tag_summary': {
      const summary = getTagSummary(str('tag'));
      const lines = [
        `#${str('tag')}`,
        `Income: $${summary.income.toFixed(2)}  Expenses: $${summary.expenses.toFixed(2)}  Net: ${summary.net >= 0 ? '+' : ''}$${summary.net.toFixed(2)}`,
        '',
        'By category:',
        ...(summary.byCategory.length
          ? summary.byCategory.map((c) => `  ${c.category}: $${c.total.toFixed(2)}`)
          : ['  (none)']),
      ];
      return lines.join('\n');
    }

    case 'uncategorized_summary': {
      const rows = db.prepare(`
        SELECT name, COUNT(*) as count FROM transactions
        WHERE category = 'Uncategorized' AND ignored = 0
        GROUP BY name ORDER BY count DESC LIMIT ?
      `).all(input['limit'] ? num('limit') : 30) as { name: string; count: number }[];
      return rows.length ? rows.map((r) => `${String(r.count).padStart(4)}x  ${r.name}`).join('\n') : 'No uncategorized transactions.';
    }

    case 'get_finance_guide': {
      if (!input['topic']) {
        const topics = getFinanceTopicList();
        return ['Topics:', ...topics.map((t) => `  ${t.topic.padEnd(18)} ${t.title}: ${t.summary}`)].join('\n');
      }
      const section = getFinanceGuide(str('topic') as GuideTopic);
      return Array.isArray(section) ? section.map(formatGuideSection).join('\n\n---\n\n') : formatGuideSection(section);
    }

    // ── Write tools ───────────────────────────────────────────────────────────

    case 'edit_transaction': {
      const tx = db.prepare('SELECT name FROM transactions WHERE id = ?').get(str('id')) as { name: string } | undefined;
      if (!tx) return `No transaction with id ${str('id')}.`;
      db.prepare('UPDATE transactions SET category = ?, manual_category = ? WHERE id = ?').run(str('category'), str('category'), str('id'));
      return `Set "${tx.name}" → ${str('category')} (pinned)`;
    }

    case 'clear_edit': {
      const tx = db.prepare('SELECT name, merchant_name, raw_category, amount FROM transactions WHERE id = ?')
        .get(str('id')) as { name: string; merchant_name: string | null; raw_category: string | null; amount: number } | undefined;
      if (!tx) return `No transaction with id ${str('id')}.`;
      const cat = categorize(tx.name, tx.merchant_name, tx.raw_category, tx.amount);
      db.prepare('UPDATE transactions SET category = ?, manual_category = NULL WHERE id = ?').run(cat, str('id'));
      return `Cleared override on "${tx.name}" — reverted to ${cat}`;
    }

    case 'ignore_transaction': {
      const tx = db.prepare('SELECT name FROM transactions WHERE id = ?').get(str('id')) as { name: string } | undefined;
      if (!tx) return `No transaction with id ${str('id')}.`;
      db.prepare('UPDATE transactions SET ignored = ? WHERE id = ?').run(bool('ignore') ? 1 : 0, str('id'));
      return `"${tx.name}" ${bool('ignore') ? 'ignored' : 'un-ignored'}`;
    }

    case 'add_rule': {
      db.prepare(
        'INSERT INTO category_rules (priority, match_type, pattern, category, min_amount, max_amount) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(input['priority'] ? num('priority') : 10, str('match_type'), str('pattern'), str('category'), opt('min_amount'), opt('max_amount'));
      const rows = db.prepare(
        'SELECT id, name, merchant_name, raw_category FROM transactions WHERE manual_category IS NULL'
      ).all() as { id: string; name: string; merchant_name: string | null; raw_category: string | null }[];
      const update = db.prepare('UPDATE transactions SET category = ? WHERE id = ?');
      let count = 0;
      for (const tx of rows) {
        const cat = categorize(tx.name, tx.merchant_name, tx.raw_category);
        if (cat !== 'Uncategorized') { update.run(cat, tx.id); count++; }
      }
      return `Rule added: "${str('pattern')}" → ${str('category')}\nRecategorized ${count} transactions.`;
    }

    case 'delete_rule': {
      const rule = db.prepare('SELECT pattern, category FROM category_rules WHERE id = ?').get(num('id')) as { pattern: string; category: string } | undefined;
      if (!rule) return `No rule with id ${num('id')}.`;
      db.prepare('DELETE FROM category_rules WHERE id = ?').run(num('id'));
      return `Deleted rule: "${rule.pattern}" → ${rule.category}`;
    }

    case 'add_name_rule': {
      db.prepare(
        'INSERT INTO name_rules (match_type, pattern, replacement, min_amount, max_amount) VALUES (?, ?, ?, ?, ?)'
      ).run(str('match_type'), str('pattern'), str('replacement'), opt('min_amount'), opt('max_amount'));
      const count = rebuildDisplayNames();
      return `Name rule added: "${str('pattern')}" → "${str('replacement')}"\nUpdated ${count} transactions.`;
    }

    case 'delete_name_rule': {
      const rule = db.prepare('SELECT pattern, replacement FROM name_rules WHERE id = ?').get(num('id')) as { pattern: string; replacement: string } | undefined;
      if (!rule) return `No name rule with id ${num('id')}.`;
      db.prepare('DELETE FROM name_rules WHERE id = ?').run(num('id'));
      return `Deleted name rule: "${rule.pattern}" → "${rule.replacement}"`;
    }

    case 'tag_transaction': {
      const tx = db.prepare('SELECT name FROM transactions WHERE id = ?').get(str('id')) as { name: string } | undefined;
      if (!tx) return `No transaction with id ${str('id')}.`;
      if (bool('add')) {
        db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(str('tag'));
        const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(str('tag')) as { id: number };
        db.prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').run(str('id'), tagRow.id);
        return `Tagged "${tx.name}" with #${str('tag')}`;
      } else {
        const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(str('tag')) as { id: number } | undefined;
        if (tagRow) db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?').run(str('id'), tagRow.id);
        return `Removed #${str('tag')} from "${tx.name}"`;
      }
    }

    case 'toggle_hidden_category': {
      if (bool('hide')) {
        db.prepare('INSERT OR IGNORE INTO hidden_categories (category) VALUES (?)').run(str('category'));
        return `"${str('category')}" is now hidden from totals.`;
      } else {
        db.prepare('DELETE FROM hidden_categories WHERE category = ?').run(str('category'));
        return `"${str('category')}" is now visible.`;
      }
    }

    case 'sync': {
      const results = await syncAll();
      const total = results.reduce((s, r) => s + r.added, 0);
      return results.map((r) => `${r.itemId}: +${r.added} added, ${r.modified} modified, ${r.removed} removed`).join('\n')
        + `\n\nTotal new transactions: ${total}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

/**
 * Run one user turn through the agent loop.
 * Mutates `history` in place (appends messages).
 * Streams text via callbacks; pauses for confirmation on write tools.
 */
export async function runAgentTurn(
  userMessage: string,
  history: Message[],
  callbacks: AgentCallbacks,
): Promise<void> {
  history.push({ role: 'user', content: userMessage });

  const system = buildSystemPrompt();

  // Agentic loop — keep going until no tool calls
  while (true) {
    const currentBlocks: ContentBlock[] = [];
    let   currentText = '';

    for await (const chunk of streamResponse(system, history, TOOL_DEFS)) {
      if (chunk.type === 'text') {
        currentText += chunk.delta;
        callbacks.onText(chunk.delta);
      } else if (chunk.type === 'tool_use') {
        if (chunk.name !== 'show') {
          callbacks.onToolCall(chunk.name, describeToolCall(chunk.name, chunk.input));
        }
        currentBlocks.push({ type: 'tool_use', id: chunk.id, name: chunk.name, input: chunk.input });
      }
    }

    if (currentText) currentBlocks.unshift({ type: 'text', text: currentText });
    history.push(makeAssistantMessage(currentBlocks));

    const toolCalls = currentBlocks.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!toolCalls.length) break;

    for (const call of toolCalls) {
      let result: string;
      try {
        result = await executeTool(call.name, call.input as Record<string, unknown>, callbacks);
      } catch (e) {
        result = `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
      history.push({ role: 'tool_result', tool_use_id: call.id, content: result });
    }
  }
}
