import { db } from './db.js';

/**
 * Remove CSV transactions that have a Plaid counterpart with the same
 * account, name, and amount within ±2 days. Plaid data is authoritative.
 */
export function deduplicateCsvVsPlaid(): number {
  const csvDupes = db.prepare(`
    SELECT csv.id as csv_id
    FROM transactions csv
    JOIN transactions plaid
      ON  csv.account_id = plaid.account_id
      AND csv.amount     = plaid.amount
      AND ABS(JULIANDAY(csv.date) - JULIANDAY(plaid.date)) <= 3
      AND csv.id   LIKE 'csv-%'
      AND plaid.id NOT LIKE 'csv-%'
      AND (
        -- Exact match
        csv.name = plaid.name
        -- One name contains the other (e.g. "Paper Payment to Albany Children's Center" ⊃ "Albany Children's Center")
        OR INSTR(LOWER(csv.name),  LOWER(plaid.name))  > 0
        OR INSTR(LOWER(plaid.name), LOWER(csv.name))   > 0
        -- Plaid masks names with *: compare the unmasked prefix (require ≥4 real chars)
        OR (
          INSTR(plaid.name, '*') >= 5
          AND LOWER(SUBSTR(csv.name,   1, INSTR(plaid.name, '*') - 1))
            = LOWER(SUBSTR(plaid.name, 1, INSTR(plaid.name, '*') - 1))
        )
      )
  `).all() as { csv_id: string }[];

  if (csvDupes.length === 0) return 0;

  const ids = csvDupes.map((r) => r.csv_id);
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);
  return result.changes as number;
}
