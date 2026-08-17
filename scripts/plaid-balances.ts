import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initDb, db } from '../core/db.js';
import { getPlaidClient, isPlaidConfigured, plaidErrorMessage } from '../core/plaid.js';
import { decryptToken } from '../core/crypto.js';
import { ENV_PATH, loadEnv, writeCsv, slug, money, truncate } from './lib/plaid-script.js';
import type { AccountBase } from 'plaid';

/**
 * Read-only diagnostic: ask each institution for its *current* balances via
 * /accounts/balance/get and diff them against what the database stored.
 *
 * The app never calls this endpoint. syncTransactions uses /accounts/get
 * (core/sync.ts), which returns Plaid's cached balance — so a stale item yields
 * a stale balance that gets written to balance_history and displayed with no
 * indication anything is wrong. /accounts/balance/get forces a fresh pull from
 * the institution, which is the only way to tell the two apart.
 *
 * Writes nothing. Safe to run against the live database.
 */

// ── args ─────────────────────────────────────────────────────────────────────

type Args = {
  itemId?: string;
  accountIds: string[];
  csv?: string | true;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { accountIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} requires a value`);
      return v;
    };
    // Consumes the next token only if it looks like a value rather than the
    // next flag, so `--csv` and `--csv out.csv` both work.
    const optional = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) return undefined;
      i++;
      return v;
    };
    switch (arg) {
      case '--item': args.itemId = next(); break;
      case '--account': args.accountIds.push(...next().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--csv': args.csv = optional() ?? true; break;
      case '--help': case '-h': usage(); process.exit(0); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  console.log(`
Fetch live balances from each bank and diff them against the database.

  npm run plaid-balances -- [options]

Options:
  --item <item_id>     Only this item. Default: every linked item.
  --account <acct_id>  Narrow to specific accounts (Plaid account_id).
                       Repeatable and comma-separated.
  --csv [path]         Write every fetched balance to a CSV. Path is optional —
                       omitted, it is named after the date in the current directory.
  --help, -h           Show this message.

Uses /accounts/balance/get, which forces a fresh pull from the institution, unlike
the /accounts/get call a normal sync makes. Writes nothing to the database.
`.trim());
}

// ── fetching ─────────────────────────────────────────────────────────────────

type ItemRow = { item_id: string; access_token: string; institution_name: string | null };

/** One item's balance fetch: either the accounts it returned, or why it failed. */
type ItemResult = {
  itemId: string;
  institution: string;
  accounts: AccountBase[];
  error?: string;
};

async function fetchItems(args: Args): Promise<ItemResult[]> {
  const res = args.itemId
    ? await db.execute({
        sql: 'SELECT item_id, access_token, institution_name FROM plaid_items WHERE item_id = ?',
        args: [args.itemId],
      })
    : await db.execute('SELECT item_id, access_token, institution_name FROM plaid_items ORDER BY institution_name');
  const items = res.rows as unknown as ItemRow[];

  if (items.length === 0) {
    if (args.itemId) {
      const all = await db.execute('SELECT item_id, institution_name FROM plaid_items ORDER BY institution_name');
      const rows = all.rows as unknown as { item_id: string; institution_name: string | null }[];
      throw new Error(
        `No linked item with item_id "${args.itemId}".`
        + (rows.length > 0
          ? ` Linked items:\n${rows.map((i) => `  ${i.item_id}  ${i.institution_name ?? '(unknown institution)'}`).join('\n')}`
          : ' Nothing is linked.'),
      );
    }
    throw new Error('No Plaid items are linked. Run `npm run link` first.');
  }

  const results: ItemResult[] = [];
  for (const item of items) {
    const institution = item.institution_name ?? '(unknown institution)';
    try {
      // One item failing must not abort the sweep — same shape as syncAll.
      const response = await getPlaidClient().accountsBalanceGet({
        access_token: decryptToken(item.access_token),
        ...(args.accountIds.length > 0 ? { options: { account_ids: args.accountIds } } : {}),
      });
      results.push({ itemId: item.item_id, institution, accounts: response.data.accounts });
    } catch (err) {
      results.push({ itemId: item.item_id, institution, accounts: [], error: plaidErrorMessage(err) });
    }
  }
  return results;
}

// ── local side ───────────────────────────────────────────────────────────────

export type LocalAccount = {
  id: string; name: string; nickname: string | null; type: string;
  mask: string | null; item_id: string | null;
  // Latest balance_history row, or null when the account has never been
  // snapshotted. A LEFT JOIN, deliberately: getAccountsWithBalances inner-joins
  // and so drops those accounts, which are exactly the interesting ones here.
  balance: number | null; balance_date: string | null;
};

async function fetchLocalAccounts(): Promise<LocalAccount[]> {
  const res = await db.execute(`
    SELECT a.id, a.name, a.nickname, a.type, a.mask, a.item_id,
           bh.balance, bh.date as balance_date
    FROM accounts a
    LEFT JOIN balance_history bh
      ON bh.account_id = a.id
     AND bh.date = (SELECT MAX(date) FROM balance_history WHERE account_id = a.id)
    ORDER BY a.name
  `);
  return res.rows as unknown as LocalAccount[];
}

// ── comparison ───────────────────────────────────────────────────────────────

export type Comparison = {
  accountId: string;
  institution: string;
  label: string;
  type: string;
  fresh: number | null;
  available: number | null;
  limit: number | null;
  currency: string | null;
  lastUpdated: string | null;
  stored: number | null;
  storedDate: string | null;
  /** fresh − stored, or null when either side is missing. */
  delta: number | null;
  /** No accounts row for an account Plaid returned — it has never been synced. */
  missingLocally: boolean;
};

/** Rounded to cents so float noise doesn't read as drift. The `|| 0` collapses
 *  negative zero, which would otherwise print as "-0.00" and read as a real
 *  difference in a column the eye scans for minus signs. */
function diff(fresh: number | null, stored: number | null): number | null {
  if (fresh === null || stored === null) return null;
  return Math.round((fresh - stored) * 100) / 100 || 0;
}

export function compareBalances(items: ItemResult[], local: LocalAccount[]): Comparison[] {
  const byId = new Map(local.map((a) => [a.id, a]));
  const out: Comparison[] = [];
  for (const item of items) {
    for (const acct of item.accounts) {
      const row = byId.get(acct.account_id);
      const fresh = acct.balances.current ?? null;
      const stored = row?.balance ?? null;
      out.push({
        accountId: acct.account_id,
        institution: item.institution,
        label: `${row?.nickname ?? acct.name}${acct.mask ? ` ···${acct.mask}` : ''}`,
        type: [acct.type, acct.subtype].filter(Boolean).join('/'),
        fresh,
        available: acct.balances.available ?? null,
        limit: acct.balances.limit ?? null,
        currency: acct.balances.iso_currency_code ?? null,
        lastUpdated: acct.balances.last_updated_datetime ?? null,
        stored,
        storedDate: row?.balance_date ?? null,
        delta: diff(fresh, stored),
        missingLocally: row === undefined,
      });
    }
  }
  return out;
}

/** Split DB accounts Plaid did not return into the expected and the suspicious. */
export function classifyUnfetched(local: LocalAccount[], fetchedIds: Set<string>) {
  const unfetched = local.filter((a) => !fetchedIds.has(a.id));
  return {
    // No Plaid item behind them, so /accounts/balance/get cannot reach them.
    expected: unfetched.filter((a) => a.id.startsWith('manual-') || a.id.startsWith('csv-')),
    // Plaid-shaped, but no live item claims them — what an orphan from a relink
    // or a removed item looks like.
    orphaned: unfetched.filter((a) => !a.id.startsWith('manual-') && !a.id.startsWith('csv-')),
  };
}

// ── csv ──────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'account_id', 'institution', 'account', 'type', 'current', 'available', 'limit',
  'iso_currency_code', 'last_updated_datetime', 'stored_balance', 'stored_date',
  'delta', 'in_local_db',
] as const;

function writeBalancesCsv(rows: Comparison[], filePath: string): number {
  return writeCsv(filePath, CSV_COLUMNS, rows.map((r) => [
    r.accountId, r.institution, r.label, r.type,
    r.fresh, r.available, r.limit, r.currency, r.lastUpdated,
    r.stored, r.storedDate, r.delta, r.missingLocally ? 'no' : 'yes',
  ]));
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!isPlaidConfigured()) {
    throw new Error(
      'Plaid is not configured — no PLAID_CLIENT_ID / PLAID_SECRET found.\n'
      + `Looked in ./.env and ${ENV_PATH}.\n`
      + 'Run `npm run setup` to store them, or set FUNGIBLE_DATA_DIR if your install lives elsewhere.',
    );
  }

  await initDb();
  const [items, local] = await Promise.all([fetchItems(args), fetchLocalAccounts()]);
  const rows = compareBalances(items, local);
  const { expected, orphaned } = classifyUnfetched(local, new Set(rows.map((r) => r.accountId)));

  const today = new Date().toISOString().slice(0, 10);
  console.log(`Fetched ${rows.length} account balance(s) from ${items.length} item(s) — live from the institution.`);
  console.log(`Today is ${today}.`);
  console.log();

  if (rows.length > 0) {
    console.log(`  ${'ACCOUNT'.padEnd(30)}  ${'CURRENT'.padStart(12)}  ${'STORED'.padStart(12)}  ${'DELTA'.padStart(10)}  AS OF`);
    for (const r of rows.sort((a, b) => a.institution.localeCompare(b.institution) || a.label.localeCompare(b.label))) {
      // A delta against an older snapshot is ordinary spending, not a fault —
      // hence printing the stored date rather than the delta alone.
      const asOf = r.missingLocally ? 'never stored' : (r.storedDate ?? '—');
      const flag = r.delta !== null && r.delta !== 0 ? '  ←' : '';
      console.log(`  ${truncate(r.label, 30)}  ${money(r.fresh, 12)}  ${money(r.stored, 12)}  ${money(r.delta, 10)}  ${asOf}${flag}`);
    }
    console.log();

    console.log('Detail (available / limit / Plaid\'s own freshness stamp):');
    for (const r of rows) {
      const stamp = r.lastUpdated ?? 'not reported by this institution';
      console.log(`  ${truncate(r.label, 30)}  ${truncate(r.type, 22)}  avail ${money(r.available)}  limit ${money(r.limit)}  ${r.currency ?? ''}  ${stamp}`);
    }
    console.log();
  }

  if (expected.length > 0) {
    console.log(`── ${expected.length} account(s) with no Plaid item (manual / CSV — not fetchable) ──`);
    for (const a of expected) {
      console.log(`  ${truncate(a.nickname ?? a.name, 30)}  stored ${money(a.balance)}  ${a.balance_date ?? 'never'}`);
    }
    console.log();
  }

  if (orphaned.length > 0) {
    console.log(`── ${orphaned.length} Plaid-shaped account(s) no live item returned ──`);
    for (const a of orphaned) {
      console.log(`  ${truncate(a.nickname ?? a.name, 30)}  item_id ${a.item_id ?? '(none)'}  stored ${money(a.balance)}  ${a.balance_date ?? 'never'}`);
    }
    console.log('  These are left over from a removed or relinked item — their balances will never update again.');
    console.log();
  }

  const failed = items.filter((i) => i.error);
  if (failed.length > 0) {
    console.log(`── ${failed.length} item(s) failed ──`);
    for (const i of failed) console.log(`  ${i.institution}  ${i.itemId}\n      ${i.error}`);
    console.log();
  }

  if (args.csv) {
    const filePath = args.csv === true ? `plaid-balances-${slug(today)}.csv` : args.csv;
    const written = writeBalancesCsv(rows, filePath);
    console.log(`Wrote ${written} row(s) to ${path.resolve(filePath)}`);
  }

  // ── verdict ──
  const drifted = rows.filter((r) => r.delta !== null && r.delta !== 0);
  const staleSnapshots = rows.filter((r) => r.storedDate !== null && r.storedDate < today);
  if (rows.length === 0) {
    console.log('No balances fetched.');
  } else if (drifted.length === 0) {
    console.log('Every fetched balance matches what the database stored.');
  } else {
    console.log(`${drifted.length} account(s) differ from the stored balance.`);
    if (staleSnapshots.length > 0) {
      console.log(`${staleSnapshots.length} of the stored balances predate today, so some drift is just`);
      console.log('activity since that snapshot. Run a sync and re-run this to separate the two:');
      console.log('a difference that survives a fresh sync is Plaid serving a stale cached balance.');
    }
  }
}

// Only run when executed directly, so tests can import the pure helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n${plaidErrorMessage(err)}`);
      process.exit(1);
    });
}
