import { config } from 'dotenv';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { DATA_DIR } from '../core/paths.js';
import { initDb, db } from '../core/db.js';
import { getPlaidClient, isPlaidConfigured, plaidErrorMessage } from '../core/plaid.js';
import { decryptToken } from '../core/crypto.js';
import type { AccountBase, Transaction } from 'plaid';

// dotenv never overwrites a variable that is already set, so the first load of a
// given key wins: a repo-local .env takes precedence for development, and
// ~/.fungible/.env — where `fungible --setup` and the GUI settings screen write
// credentials — fills in anything it did not define. Reading both is what makes
// this script work whether it is run from the repo or against a real install.
// Nothing here reads PLAID_* at import time (core/plaid.ts resolves them per
// call), so running these after the imports above is safe.
const ENV_PATH = path.join(DATA_DIR, '.env');
config({ quiet: true });
config({ path: ENV_PATH, quiet: true });

/**
 * Read-only diagnostic: ask Plaid what it holds for an item over a date range
 * via /transactions/get, and diff it against the local transactions table.
 *
 * /transactions/sync only ever reports what changed since a cursor, so it can't
 * answer "did Plaid ever send me this?". /transactions/get takes an explicit
 * window and returns everything Plaid currently holds, which separates the two
 * failure modes: Plaid never had the transaction (relink with a wider
 * days_requested), or Plaid has it and we dropped it (reset the cursor).
 *
 * Writes nothing. Safe to run against the live database.
 */

// ── args ─────────────────────────────────────────────────────────────────────

type Args = {
  itemId?: string;
  accountIds: string[];
  allAccounts: boolean;
  start?: string;
  end?: string;
  days?: number;
  verbose: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { accountIds: [], allAccounts: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case '--item': args.itemId = next(); break;
      // Repeatable and comma-separated, so `--account a --account b` and
      // `--account a,b` both work.
      case '--account': args.accountIds.push(...next().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--all-accounts': args.allAccounts = true; break;
      case '--start': args.start = next(); break;
      case '--end': args.end = next(); break;
      case '--days': args.days = Number(next()); break;
      case '--verbose': case '-v': args.verbose = true; break;
      case '--help': case '-h': usage(); process.exit(0); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.allAccounts && args.accountIds.length > 0) {
    throw new Error('--all-accounts and --account are mutually exclusive.');
  }
  return args;
}

function usage() {
  console.log(`
Diff what Plaid holds for an item against the local database.

  npm run plaid-diff -- [options]

Options:
  --item <item_id>       Plaid item to check. Prompts if more than one is linked.
  --account <acct_id>    Narrow to specific accounts (Plaid account_id). Repeatable
                         and comma-separated. Prompts if the item has several and
                         neither this nor --all-accounts is given.
  --all-accounts         Check every account on the item without prompting.
  --start <YYYY-MM-DD>   Start of window. Defaults to --days back from --end.
  --end <YYYY-MM-DD>     End of window. Defaults to today.
  --days <n>             Window size when --start is omitted. Default 30.
  --verbose, -v          List every matched transaction, not just differences.
  --help, -h             Show this message.

Without a TTY (piped, cron, CI) the prompts are skipped: --item becomes required
when several items are linked, and all accounts are checked by default.
`.trim());
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function resolveWindow(args: Args): { start: string; end: string } {
  const end = args.end ?? new Date().toISOString().slice(0, 10);
  if (args.end && !isIsoDate(args.end)) throw new Error(`--end must be YYYY-MM-DD, got "${args.end}"`);
  if (args.start && !isIsoDate(args.start)) throw new Error(`--start must be YYYY-MM-DD, got "${args.start}"`);

  let start = args.start;
  if (!start) {
    const days = args.days ?? 30;
    if (!Number.isInteger(days) || days < 1) throw new Error(`--days must be a positive integer, got "${args.days}"`);
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    start = d.toISOString().slice(0, 10);
  }
  if (start > end) throw new Error(`--start (${start}) is after --end (${end})`);
  return { start, end };
}

// ── prompting ────────────────────────────────────────────────────────────────

/** Prompts are only offered on a real terminal. Piped into a file, run from cron
 *  or CI, there is nobody to answer, so callers fall back to flags/defaults. */
const interactive = process.stdin.isTTY && process.stdout.isTTY;

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // On Ctrl-D readline closes without ever settling question()'s promise, so
    // race it against 'close' to fail loudly instead of hanging.
    const answer = await new Promise<string>((resolve, reject) => {
      rl.once('close', () => reject(new Error('Input closed before an answer was given.')));
      rl.question(question).then(resolve, reject);
    });
    return answer.trim();
  } finally {
    rl.close();
  }
}

export type SelectMode = { multi: boolean; defaultAll: boolean };

/**
 * Turn a typed answer into zero-based indices, or an error message to show
 * before re-asking. Split out from the prompt loop so the fiddly parts —
 * "all", duplicates, out-of-range, multiple numbers in single mode — are
 * testable without a terminal.
 */
export function parseSelection(
  answer: string, optionCount: number, { multi, defaultAll }: SelectMode,
): { indices: number[] } | { error: string } {
  const trimmed = answer.trim();
  const all = () => ({ indices: Array.from({ length: optionCount }, (_, i) => i) });

  if (multi) {
    if (trimmed === '' && defaultAll) return all();
    if (/^(a|all)$/i.test(trimmed)) return all();
  }

  const tokens = trimmed.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return { error: multi ? 'Enter at least one number.' : 'Enter a number.' };
  if (!multi && tokens.length > 1) return { error: 'Enter a single number.' };

  const indices: number[] = [];
  for (const token of tokens) {
    // Number('') is 0 and Number('1.5') is not an integer; both must be rejected.
    const n = Number(token);
    if (!Number.isInteger(n) || n < 1 || n > optionCount) {
      return { error: `"${token}" is not a number between 1 and ${optionCount}.` };
    }
    if (!indices.includes(n - 1)) indices.push(n - 1);
  }
  return { indices };
}

/**
 * Numbered chooser. Re-asks on bad input rather than exiting — the user is here
 * to find a missing transaction, and losing the run to a typo is worse than
 * asking twice. EOF (Ctrl-D) has no answer to re-ask for, so it aborts.
 */
async function choose<T>(
  label: string, options: T[], render: (o: T) => string, mode: SelectMode,
): Promise<T[]> {
  console.log(`\n${label}`);
  options.forEach((o, i) => console.log(`  ${String(i + 1).padStart(2)}. ${render(o)}`));
  const hint = mode.multi
    ? `\nWhich? (numbers separated by commas, "all"${mode.defaultAll ? ', or Enter for all' : ''}): `
    : '\nWhich? (number): ';

  for (;;) {
    const answer = await ask(hint);
    const result = parseSelection(answer, options.length, mode);
    if ('error' in result) {
      console.log(result.error);
      continue;
    }
    return result.indices.map((i) => options[i]);
  }
}

// ── item resolution ──────────────────────────────────────────────────────────

type ItemRow = { item_id: string; access_token: string; institution_name: string | null; days_requested: number | null };

function describeItem(i: ItemRow): string {
  return `${i.institution_name ?? '(unknown institution)'}  ${i.item_id}`;
}

async function resolveItem(itemId?: string): Promise<ItemRow> {
  const res = await db.execute(
    'SELECT item_id, access_token, institution_name, days_requested FROM plaid_items ORDER BY institution_name',
  );
  const items = res.rows as unknown as ItemRow[];
  if (items.length === 0) throw new Error('No Plaid items are linked. Run `npm run link` first.');

  if (itemId) {
    const match = items.find((i) => i.item_id === itemId);
    if (!match) {
      throw new Error(
        `No linked item with item_id "${itemId}". Linked items:\n`
        + items.map((i) => `  ${describeItem(i)}`).join('\n'),
      );
    }
    return match;
  }
  if (items.length === 1) return items[0];

  if (!interactive) {
    throw new Error(
      'Multiple items are linked — pass --item <item_id>:\n'
      + items.map((i) => `  ${describeItem(i)}`).join('\n'),
    );
  }
  const [chosen] = await choose('Which item?', items, describeItem, { multi: false, defaultAll: false });
  return chosen;
}

// ── account resolution ───────────────────────────────────────────────────────

function describeAccount(a: AccountBase): string {
  const mask = a.mask ? ` ••${a.mask}` : '';
  const kind = [a.type, a.subtype].filter(Boolean).join('/');
  return `${a.name}${mask}  (${kind})`;
}

/**
 * Decide which of the item's accounts to diff. Returns `undefined` to mean "all
 * of them", which is passed through as an omitted `account_ids` rather than an
 * explicit list of every id — Plaid rejects account_ids for accounts that do not
 * support transactions, so naming them all can fail where omitting cannot.
 */
async function resolveAccounts(accessToken: string, args: Args): Promise<AccountBase[] | undefined> {
  const accounts = (await getPlaidClient().accountsGet({ access_token: accessToken })).data.accounts;
  if (accounts.length === 0) throw new Error('Plaid reports no accounts on this item.');

  if (args.accountIds.length > 0) {
    const byId = new Map(accounts.map((a) => [a.account_id, a]));
    const unknown = args.accountIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `No account on this item with account_id ${unknown.map((u) => `"${u}"`).join(', ')}. Available:\n`
        + accounts.map((a) => `  ${a.account_id}  ${describeAccount(a)}`).join('\n'),
      );
    }
    return args.accountIds.map((id) => byId.get(id)!);
  }

  if (args.allAccounts || accounts.length === 1 || !interactive) return undefined;

  const picked = await choose(
    `This item has ${accounts.length} accounts.`, accounts, describeAccount,
    { multi: true, defaultAll: true },
  );
  return picked.length === accounts.length ? undefined : picked;
}

// ── fetching ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 500; // Plaid's maximum for /transactions/get

/**
 * Page through /transactions/get. Plaid warns that total_transactions can shift
 * between paginated calls if the item updates mid-read, so this dedupes by
 * transaction_id and stops on an empty page rather than trusting the total.
 */
async function fetchPlaidTransactions(
  accessToken: string, start: string, end: string, accountIds?: string[],
): Promise<{ transactions: Transaction[]; accountIds: string[]; accountNames: Map<string, string> }> {
  const client = getPlaidClient();
  const byId = new Map<string, Transaction>();
  const accountNames = new Map<string, string>();
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await client.transactionsGet({
      access_token: accessToken,
      start_date: start,
      end_date: end,
      options: {
        count: PAGE_SIZE,
        offset,
        ...(accountIds && accountIds.length > 0 ? { account_ids: accountIds } : {}),
      },
    });
    const data = response.data;
    total = data.total_transactions;
    for (const acct of data.accounts) {
      accountNames.set(acct.account_id, `${acct.name}${acct.mask ? ` ••${acct.mask}` : ''}`);
    }
    if (data.transactions.length === 0) break;
    for (const tx of data.transactions) byId.set(tx.transaction_id, tx);
    offset += data.transactions.length;
  }

  return { transactions: [...byId.values()], accountIds: [...accountNames.keys()], accountNames };
}

type LocalRow = {
  id: string; account_id: string; date: string; name: string;
  amount: number; pending: number; ignored: number;
};

async function fetchLocalTransactions(accountIds: string[], start: string, end: string): Promise<LocalRow[]> {
  if (accountIds.length === 0) return [];
  const placeholders = accountIds.map(() => '?').join(',');
  const res = await db.execute({
    sql: `SELECT id, account_id, date, name, amount, pending, ignored
          FROM transactions
          WHERE account_id IN (${placeholders}) AND date >= ? AND date <= ?
          ORDER BY date DESC`,
    args: [...accountIds, start, end],
  });
  return res.rows as unknown as LocalRow[];
}

// ── reporting ────────────────────────────────────────────────────────────────

function money(amount: number): string {
  return amount.toFixed(2).padStart(10);
}

function truncate(s: string, width: number): string {
  return s.length <= width ? s.padEnd(width) : `${s.slice(0, width - 1)}…`;
}

function line(date: string, amount: number, name: string, account: string, suffix = ''): string {
  return `  ${date}  ${money(amount)}  ${truncate(name, 38)}  ${truncate(account, 24)}${suffix}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { start, end } = resolveWindow(args);

  if (!isPlaidConfigured()) {
    throw new Error(
      'Plaid is not configured — no PLAID_CLIENT_ID / PLAID_SECRET found.\n'
      + `Looked in ./.env and ${ENV_PATH}.\n`
      + 'Run `npm run setup` to store them, or set FUNGIBLE_DATA_DIR if your install lives elsewhere.',
    );
  }

  await initDb();
  const item = await resolveItem(args.itemId);
  const accessToken = decryptToken(item.access_token);
  const selected = await resolveAccounts(accessToken, args);
  const selectedIds = selected?.map((a) => a.account_id);

  console.log(`\nItem:      ${describeItem(item)}`);
  console.log(`Window:    ${start} → ${end}`);
  console.log(`History:   days_requested = ${item.days_requested ?? '(unset — Plaid default is 90)'}`);
  console.log(`Accounts:  ${selected ? selected.map(describeAccount).join('\n           ') : 'all on this item'}`);
  console.log();

  const { transactions: plaidTxs, accountIds, accountNames } =
    await fetchPlaidTransactions(accessToken, start, end, selectedIds);

  const localRows = await fetchLocalTransactions(selectedIds ?? accountIds, start, end);
  const localById = new Map(localRows.map((r) => [r.id, r]));
  const plaidById = new Map(plaidTxs.map((t) => [t.transaction_id, t]));

  const acctName = (id: string) => accountNames.get(id) ?? id;

  // 1. In Plaid, absent locally — the transactions you're looking for.
  const missing = plaidTxs
    .filter((t) => !localById.has(t.transaction_id))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 2. Local Plaid-sourced rows Plaid no longer returns in this window. Some are
  //    legitimately stale (Plaid sent a `removed` we applied late, or never);
  //    others just shifted date when they posted and now sit outside the window.
  const stale = localRows
    .filter((r) => !r.id.startsWith('csv-') && !plaidById.has(r.id))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 3. Same transaction_id on both sides, but a field drifted.
  const drifted: { tx: Transaction; local: LocalRow; fields: string[] }[] = [];
  for (const tx of plaidTxs) {
    const local = localById.get(tx.transaction_id);
    if (!local) continue;
    const fields: string[] = [];
    if (local.date !== tx.date) fields.push(`date ${local.date} → ${tx.date}`);
    if (Math.abs(local.amount - tx.amount) > 0.005) fields.push(`amount ${local.amount} → ${tx.amount}`);
    if (local.name !== tx.name) fields.push('name');
    if (!!local.pending !== !!tx.pending) fields.push(`pending ${!!local.pending} → ${!!tx.pending}`);
    if (fields.length > 0) drifted.push({ tx, local, fields });
  }

  const csvRows = localRows.filter((r) => r.id.startsWith('csv-'));
  const ignoredRows = localRows.filter((r) => r.ignored);

  // ── output ──
  console.log(`Plaid returned ${plaidTxs.length} transaction(s) across ${accountIds.length} account(s).`);
  console.log(`Local database has ${localRows.length} row(s) in the same window `
    + `(${csvRows.length} CSV-sourced, ${ignoredRows.length} flagged ignored).`);
  console.log();

  if (missing.length > 0) {
    console.log(`── ${missing.length} in Plaid, MISSING locally ──`);
    for (const tx of missing) {
      console.log(line(tx.date, tx.amount, tx.name, acctName(tx.account_id), tx.pending ? '  [pending]' : ''));
      if (args.verbose) console.log(`      ${tx.transaction_id}`);
    }
    console.log();
  }

  if (stale.length > 0) {
    console.log(`── ${stale.length} local, NOT returned by Plaid ──`);
    for (const r of stale) {
      console.log(line(r.date, r.amount, r.name, acctName(r.account_id), r.pending ? '  [pending]' : ''));
      if (args.verbose) console.log(`      ${r.id}`);
    }
    console.log();
  }

  if (drifted.length > 0) {
    console.log(`── ${drifted.length} present on both sides, fields differ ──`);
    for (const { tx, fields } of drifted) {
      console.log(line(tx.date, tx.amount, tx.name, acctName(tx.account_id)));
      console.log(`      ${fields.join(', ')}`);
    }
    console.log();
  }

  if (args.verbose) {
    const matched = plaidTxs
      .filter((t) => localById.has(t.transaction_id))
      .sort((a, b) => a.date.localeCompare(b.date));
    console.log(`── ${matched.length} matched ──`);
    for (const tx of matched) {
      console.log(line(tx.date, tx.amount, tx.name, acctName(tx.account_id)));
    }
    console.log();
  }

  // ── verdict ──
  if (missing.length === 0 && stale.length === 0 && drifted.length === 0) {
    console.log('No differences. Plaid and the local database agree over this window.');
    console.log('If transactions still look absent in the UI, they were never in Plaid\'s copy —');
    console.log('check the window against days_requested above, or check account/category filters.');
  } else if (missing.length > 0) {
    console.log('Plaid holds transactions the database does not. A cursor reset will replay them:');
    console.log(`  DELETE FROM sync_state WHERE account_id = '${item.item_id}';`);
    console.log('then run a sync. Every write in core/sync.ts is an upsert, so this is idempotent.');
  } else if (stale.length > 0) {
    console.log('The database holds rows Plaid does not return for this window. Most are likely');
    console.log('transactions whose date shifted when they posted — widen the window and re-run');
    console.log('before concluding they are stale.');
  }
}

// Only run when executed directly, so tests can import parseSelection.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n${plaidErrorMessage(err)}`);
      process.exit(1);
    });
}
