import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initDb, db } from '../core/db.js';
import { getMonthlySummary, getRangeSummary, getTagSummary } from '../core/queries.js';
import { categorize } from '../core/categorize.js';
import { syncAll } from '../core/sync.js';

initDb();

const server = new McpServer({
  name: 'fungible',
  version: '1.0.0',
});

// ── spending_summary ──────────────────────────────────────────────────────────

server.tool(
  'spending_summary',
  'Get income, expenses, net, and spending by category. Provide either (year + month) for a specific month, or (from + to) for an arbitrary date range.',
  {
    year:  z.number().int().optional().describe('4-digit year, e.g. 2026'),
    month: z.number().int().min(1).max(12).optional().describe('Month number 1–12'),
    from:  z.string().optional().describe('Start date YYYY-MM-DD (use with to)'),
    to:    z.string().optional().describe('End date YYYY-MM-DD (use with from)'),
  },
  async ({ year, month, from, to }) => {
    let label: string;
    let summary;
    if (from && to) {
      summary = getRangeSummary(from, to);
      label = `${from} – ${to}`;
    } else if (year && month) {
      summary = getMonthlySummary(year, month);
      label = `${new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })} ${year}`;
    } else {
      return { content: [{ type: 'text', text: 'Provide either (year + month) or (from + to).' }] };
    }

    const lines = [
      `## ${label}`,
      `- **Income:** $${summary.income.toFixed(2)}`,
      `- **Expenses:** $${summary.expenses.toFixed(2)}`,
      `- **Net:** ${summary.net >= 0 ? '+' : ''}$${summary.net.toFixed(2)}`,
      '',
      '### Spending by Category',
      ...summary.byCategory.map((c) => `- ${c.category}: $${c.total.toFixed(2)}`),
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── list_transactions ─────────────────────────────────────────────────────────

server.tool(
  'list_transactions',
  'List transactions with optional filters. Returns date, name, amount, category, account. Ignored transactions are marked.',
  {
    category:      z.string().optional().describe('Filter by category name'),
    month:         z.number().int().min(1).max(12).optional().describe('Month 1–12'),
    year:          z.number().int().optional().describe('4-digit year'),
    search:        z.string().optional().describe('Search within name or display name'),
    include_ignored: z.boolean().default(false).describe('Include ignored transactions (default false)'),
    limit:         z.number().int().min(1).max(500).default(50).describe('Max results (default 50)'),
  },
  async ({ category, month, year, search, include_ignored, limit }) => {
    const conditions: string[] = [];
    const args: (string | number)[] = [];

    if (!include_ignored) { conditions.push('t.ignored = 0'); }
    if (category) { conditions.push('t.category = ?'); args.push(category); }
    if (month && year) {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const to   = `${year}-${String(month).padStart(2, '0')}-31`;
      conditions.push('t.date >= ? AND t.date <= ?'); args.push(from, to);
    }
    if (search) {
      conditions.push('(t.name LIKE ? OR t.display_name LIKE ?)');
      args.push(`%${search}%`, `%${search}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = db.prepare(`
      SELECT t.id, t.date, COALESCE(t.display_name, t.name) as name, t.amount,
             t.category, t.manual_category, t.ignored, a.name as account
      FROM transactions t
      LEFT JOIN accounts a ON t.account_id = a.id
      ${where}
      ORDER BY t.date DESC
      LIMIT ?
    `).all(...args, limit) as {
      id: string; date: string; name: string; amount: number;
      category: string; manual_category: string | null; ignored: number; account: string;
    }[];

    if (rows.length === 0) return { content: [{ type: 'text', text: 'No transactions found.' }] };

    const lines = rows.map((r) => {
      const sign = r.amount < 0 ? '+' : '-';
      const flags = [r.manual_category ? '◆' : ' ', r.ignored ? '~' : ' '].join('');
      return `${r.date}  ${flags}  ${r.name.padEnd(36).slice(0, 36)}  ${sign}$${Math.abs(r.amount).toFixed(2).padStart(9)}  ${r.category}  [${r.id}]`;
    });

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── edit_transaction ──────────────────────────────────────────────────────────

server.tool(
  'edit_transaction',
  'Manually set the category for a specific transaction (pins it — survives syncs). Use list_transactions to get the ID.',
  {
    id:       z.string().describe('Transaction ID from list_transactions'),
    category: z.string().describe('Category to assign'),
  },
  async ({ id, category }) => {
    const tx = db.prepare('SELECT name FROM transactions WHERE id = ?').get(id) as { name: string } | undefined;
    if (!tx) return { content: [{ type: 'text', text: `No transaction with id ${id}.` }] };

    db.prepare('UPDATE transactions SET category = ?, manual_category = ? WHERE id = ?')
      .run(category, category, id);

    return { content: [{ type: 'text', text: `Set "${tx.name}" → ${category} (pinned)` }] };
  }
);

// ── clear_edit ────────────────────────────────────────────────────────────────

server.tool(
  'clear_edit',
  'Remove a manual category override from a transaction, reverting it to rule-based categorization.',
  {
    id: z.string().describe('Transaction ID from list_transactions'),
  },
  async ({ id }) => {
    const tx = db.prepare('SELECT name, merchant_name, raw_category FROM transactions WHERE id = ?')
      .get(id) as { name: string; merchant_name: string | null; raw_category: string | null } | undefined;
    if (!tx) return { content: [{ type: 'text', text: `No transaction with id ${id}.` }] };

    const cat = categorize(tx.name, tx.merchant_name, tx.raw_category);
    db.prepare('UPDATE transactions SET category = ?, manual_category = NULL WHERE id = ?').run(cat, id);

    return { content: [{ type: 'text', text: `Cleared override on "${tx.name}" — reverted to ${cat}` }] };
  }
);

// ── ignore_transaction ────────────────────────────────────────────────────────

server.tool(
  'ignore_transaction',
  'Toggle the ignored flag on a transaction. Ignored transactions are hidden from totals and charts.',
  {
    id:     z.string().describe('Transaction ID from list_transactions'),
    ignore: z.boolean().describe('true to ignore, false to un-ignore'),
  },
  async ({ id, ignore }) => {
    const tx = db.prepare('SELECT name FROM transactions WHERE id = ?').get(id) as { name: string } | undefined;
    if (!tx) return { content: [{ type: 'text', text: `No transaction with id ${id}.` }] };

    db.prepare('UPDATE transactions SET ignored = ? WHERE id = ?').run(ignore ? 1 : 0, id);
    return { content: [{ type: 'text', text: `"${tx.name}" ${ignore ? 'ignored' : 'un-ignored'}` }] };
  }
);

// ── list_rules ────────────────────────────────────────────────────────────────

server.tool(
  'list_rules',
  'List all category rules.',
  {},
  async () => {
    const rules = db.prepare(
      'SELECT id, priority, match_type, pattern, category FROM category_rules ORDER BY priority DESC, id ASC'
    ).all() as { id: number; priority: number; match_type: string; pattern: string; category: string }[];

    if (rules.length === 0) return { content: [{ type: 'text', text: 'No rules defined.' }] };

    const lines = rules.map(
      (r) => `[${r.id}] pri=${r.priority} ${r.match_type.padEnd(5)} "${r.pattern}" → ${r.category}`
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── add_rule ──────────────────────────────────────────────────────────────────

server.tool(
  'add_rule',
  'Add a category rule and immediately apply it to all non-manually-categorized transactions.',
  {
    pattern:    z.string().describe('Text to match against transaction name'),
    match_type: z.enum(['name', 'regex']).describe('"name" for substring match, "regex" for regex'),
    category:   z.string().describe('Category to assign, e.g. "Food & Drink"'),
    priority:   z.number().int().default(10).describe('Higher priority rules run first (default 10)'),
  },
  async ({ pattern, match_type, category, priority }) => {
    db.prepare(
      'INSERT INTO category_rules (priority, match_type, pattern, category) VALUES (?, ?, ?, ?)'
    ).run(priority, match_type, pattern, category);

    const rows = db.prepare(
      'SELECT id, name, merchant_name, raw_category FROM transactions WHERE manual_category IS NULL'
    ).all() as { id: string; name: string; merchant_name: string | null; raw_category: string | null }[];

    const update = db.prepare('UPDATE transactions SET category = ? WHERE id = ?');
    let count = 0;
    for (const tx of rows) {
      const cat = categorize(tx.name, tx.merchant_name, tx.raw_category);
      if (cat !== 'Uncategorized') { update.run(cat, tx.id); count++; }
    }

    return {
      content: [{
        type: 'text',
        text: `Rule added: "${pattern}" → ${category}\nRecategorized ${count} transactions.`,
      }],
    };
  }
);

// ── delete_rule ───────────────────────────────────────────────────────────────

server.tool(
  'delete_rule',
  'Delete a category rule by ID. Use list_rules to find the ID.',
  {
    id: z.number().int().describe('Rule ID from list_rules'),
  },
  async ({ id }) => {
    const rule = db.prepare('SELECT * FROM category_rules WHERE id = ?').get(id) as { pattern: string; category: string } | undefined;
    if (!rule) return { content: [{ type: 'text', text: `No rule with id ${id}.` }] };

    db.prepare('DELETE FROM category_rules WHERE id = ?').run(id);
    return { content: [{ type: 'text', text: `Deleted rule [${id}]: "${rule.pattern}" → ${rule.category}` }] };
  }
);

// ── list_name_rules ───────────────────────────────────────────────────────────

server.tool(
  'list_name_rules',
  'List all name rules (rules that rename transaction display names).',
  {},
  async () => {
    const rules = db.prepare(
      'SELECT id, match_type, pattern, replacement FROM name_rules ORDER BY id ASC'
    ).all() as { id: number; match_type: string; pattern: string; replacement: string }[];

    if (rules.length === 0) return { content: [{ type: 'text', text: 'No name rules defined.' }] };

    const lines = rules.map(
      (r) => `[${r.id}] ${r.match_type.padEnd(5)} "${r.pattern}" → "${r.replacement}"`
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── add_name_rule ─────────────────────────────────────────────────────────────

server.tool(
  'add_name_rule',
  'Add a name rule that renames how transactions are displayed (does not affect rule matching).',
  {
    pattern:     z.string().describe('Text or regex to match against transaction name'),
    match_type:  z.enum(['name', 'regex']).describe('"name" for substring match, "regex" for regex'),
    replacement: z.string().describe('Display name to show instead'),
  },
  async ({ pattern, match_type, replacement }) => {
    db.prepare(
      'INSERT INTO name_rules (match_type, pattern, replacement) VALUES (?, ?, ?)'
    ).run(match_type, pattern, replacement);

    // Rebuild display names for all transactions
    const { rebuildDisplayNames } = await import('../core/rename.js');
    const count = rebuildDisplayNames();

    return {
      content: [{
        type: 'text',
        text: `Name rule added: "${pattern}" → "${replacement}"\nUpdated display names for ${count} transactions.`,
      }],
    };
  }
);

// ── delete_name_rule ──────────────────────────────────────────────────────────

server.tool(
  'delete_name_rule',
  'Delete a name rule by ID. Use list_name_rules to find the ID.',
  {
    id: z.number().int().describe('Name rule ID from list_name_rules'),
  },
  async ({ id }) => {
    const rule = db.prepare('SELECT * FROM name_rules WHERE id = ?').get(id) as { pattern: string; replacement: string } | undefined;
    if (!rule) return { content: [{ type: 'text', text: `No name rule with id ${id}.` }] };

    db.prepare('DELETE FROM name_rules WHERE id = ?').run(id);
    return { content: [{ type: 'text', text: `Deleted name rule [${id}]: "${rule.pattern}" → "${rule.replacement}"` }] };
  }
);

// ── list_hidden_categories ────────────────────────────────────────────────────

server.tool(
  'list_hidden_categories',
  'List categories hidden from totals and charts (e.g. Transfer, Loan Payment).',
  {},
  async () => {
    const rows = db.prepare('SELECT category FROM hidden_categories ORDER BY category').all() as { category: string }[];
    if (rows.length === 0) return { content: [{ type: 'text', text: 'No hidden categories.' }] };
    return { content: [{ type: 'text', text: rows.map((r) => r.category).join('\n') }] };
  }
);

// ── toggle_hidden_category ────────────────────────────────────────────────────

server.tool(
  'toggle_hidden_category',
  'Add or remove a category from the hidden list. Hidden categories are excluded from expense totals and charts.',
  {
    category: z.string().describe('Category name, e.g. "Transfer"'),
    hide:     z.boolean().describe('true to hide, false to unhide'),
  },
  async ({ category, hide }) => {
    if (hide) {
      db.prepare('INSERT OR IGNORE INTO hidden_categories (category) VALUES (?)').run(category);
      return { content: [{ type: 'text', text: `"${category}" is now hidden.` }] };
    } else {
      db.prepare('DELETE FROM hidden_categories WHERE category = ?').run(category);
      return { content: [{ type: 'text', text: `"${category}" is now visible.` }] };
    }
  }
);

// ── list_accounts ─────────────────────────────────────────────────────────────

server.tool(
  'list_accounts',
  'List all connected bank accounts.',
  {},
  async () => {
    const accounts = db.prepare(
      'SELECT name, type, subtype, mask, institution_name FROM accounts'
    ).all() as { name: string; type: string; subtype: string; mask: string | null; institution_name: string | null }[];

    if (accounts.length === 0) return { content: [{ type: 'text', text: 'No accounts connected.' }] };

    const lines = accounts.map(
      (a) => `${a.name} (${a.subtype}) ···${a.mask ?? '?'} — ${a.institution_name ?? 'Unknown'}`
    );
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── sync ──────────────────────────────────────────────────────────────────────

server.tool(
  'sync',
  'Sync latest transactions from Plaid for all connected accounts.',
  {},
  async () => {
    const results = await syncAll();
    const lines = results.map(
      (r) => `${r.itemId}: +${r.added} added, ${r.modified} modified, ${r.removed} removed, ${(r as any).dupes ?? 0} dupes removed`
    );
    const total = results.reduce((s, r) => s + r.added, 0);
    lines.push(`\nTotal new transactions: ${total}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── uncategorized_summary ─────────────────────────────────────────────────────

server.tool(
  'uncategorized_summary',
  'Show the most common uncategorized transaction names to help write new rules.',
  {
    limit: z.number().int().min(1).max(100).default(30),
  },
  async ({ limit }) => {
    const rows = db.prepare(`
      SELECT name, COUNT(*) as count
      FROM transactions
      WHERE category = 'Uncategorized' AND ignored = 0
      GROUP BY name
      ORDER BY count DESC
      LIMIT ?
    `).all(limit) as { name: string; count: number }[];

    if (rows.length === 0) return { content: [{ type: 'text', text: 'No uncategorized transactions.' }] };

    const lines = rows.map((r) => `${String(r.count).padStart(4)}x  ${r.name}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── list_tags ─────────────────────────────────────────────────────────────────

server.tool(
  'list_tags',
  'List all tags with transaction counts.',
  {},
  async () => {
    const rows = db.prepare(`
      SELECT t.name, COUNT(tt.transaction_id) as count
      FROM tags t
      LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
      GROUP BY t.id
      ORDER BY t.name
    `).all() as { name: string; count: number }[];

    if (rows.length === 0) return { content: [{ type: 'text', text: 'No tags defined.' }] };
    const lines = rows.map((r) => `${r.name.padEnd(30)} ${r.count} transaction${r.count !== 1 ? 's' : ''}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── tag_summary ───────────────────────────────────────────────────────────────

server.tool(
  'tag_summary',
  'Get income, expenses, net, and spending by category for all transactions tagged with a given tag.',
  {
    tag: z.string().describe('Tag name'),
  },
  async ({ tag }) => {
    const summary = getTagSummary(tag);

    const lines = [
      `## #${tag}`,
      `- **Income:** $${summary.income.toFixed(2)}`,
      `- **Expenses:** $${summary.expenses.toFixed(2)}`,
      `- **Net:** ${summary.net >= 0 ? '+' : ''}$${summary.net.toFixed(2)}`,
      '',
      '### Spending by Category',
      ...(summary.byCategory.length
        ? summary.byCategory.map((c) => `- ${c.category}: $${c.total.toFixed(2)}`)
        : ['No expense data for this tag.']),
    ];

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ── tag_transaction ───────────────────────────────────────────────────────────

server.tool(
  'tag_transaction',
  'Add or remove a tag on a transaction. Creates the tag if it does not exist.',
  {
    id:  z.string().describe('Transaction ID from list_transactions'),
    tag: z.string().describe('Tag name'),
    add: z.boolean().describe('true to add the tag, false to remove it'),
  },
  async ({ id, tag, add }) => {
    const tx = db.prepare('SELECT name FROM transactions WHERE id = ?').get(id) as { name: string } | undefined;
    if (!tx) return { content: [{ type: 'text', text: `No transaction with id ${id}.` }] };

    if (add) {
      db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tag);
      const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag) as { id: number };
      db.prepare('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').run(id, tagRow.id);
      return { content: [{ type: 'text', text: `Tagged "${tx.name}" with #${tag}` }] };
    } else {
      const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(tag) as { id: number } | undefined;
      if (tagRow) {
        db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?').run(id, tagRow.id);
      }
      return { content: [{ type: 'text', text: `Removed #${tag} from "${tx.name}"` }] };
    }
  }
);

// ── start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
