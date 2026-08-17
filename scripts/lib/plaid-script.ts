import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../core/paths.js';

/** Where `fungible --setup` and the GUI settings screen store credentials. */
export const ENV_PATH = path.join(DATA_DIR, '.env');

/**
 * Load Plaid credentials for a standalone script.
 *
 * dotenv never overwrites a variable that is already set, so the first load of a
 * given key wins: a repo-local .env takes precedence for development, and
 * ~/.fungible/.env fills in anything it did not define. Reading both is what
 * lets these scripts run either from the repo or against a real install.
 *
 * Call it first thing in main() rather than at module scope — nothing reads
 * PLAID_* at import time (core/plaid.ts resolves them per call), so the timing
 * is safe either way, and an explicit call beats depending on import order.
 *
 * FUNGIBLE_DATA_DIR deliberately cannot come from a .env file: it selects the
 * directory the file itself lives in. core/paths.ts reads it from the real
 * environment, as tui/index.tsx and api/server.ts also assume.
 */
export function loadEnv(): void {
  config({ quiet: true });
  config({ path: ENV_PATH, quiet: true });
}

/** RFC 4180 quoting: wrap in quotes and double any internal quote, but only
 *  when the value actually needs it — merchant names carry commas routinely. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Write a CSV, creating parent directories. Returns the row count (sans header). */
export function writeCsv(filePath: string, header: readonly string[], rows: unknown[][]): number {
  const lines = [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return rows.length;
}

/** Filesystem-safe stem from an institution name, for default filenames. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plaid';
}

export function money(amount: number | null | undefined, width = 10): string {
  return (amount === null || amount === undefined ? '—' : amount.toFixed(2)).padStart(width);
}

export function truncate(s: string, width: number): string {
  return s.length <= width ? s.padEnd(width) : `${s.slice(0, width - 1)}…`;
}
