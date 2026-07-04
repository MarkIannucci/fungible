import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: await makeTestDb() };
});

import { db } from '../core/db.js';
import { executeTool } from '../core/tools.js';

let txId = 0;
async function insertTx(date: string, amount: number, category: string) {
  txId++;
  await db.execute({
    sql: `INSERT INTO transactions (id, account_id, date, name, amount, category, pending, ignored)
          VALUES (?, 'acct1', ?, 'Test', ?, ?, 0, 0)`,
    args: [`tx${txId}`, date, amount, category],
  });
}

beforeEach(async () => {
  txId = 0;
  await db.execute('DELETE FROM transactions');
  await db.execute('DELETE FROM hidden_categories');
});

describe('get_scorecard tool output', () => {
  it('buckets categories and reports a net verdict (calendar month window)', async () => {
    // Deterministic with month windows: txs on the 15th land in every
    // day-capped rolling window regardless of month length.
    const priors = ['2026-05', '2026-04', '2026-03', '2026-02', '2026-01', '2025-12',
                    '2025-11', '2025-10', '2025-09', '2025-08', '2025-07', '2025-06'];
    for (const ym of priors) {
      await insertTx(`${ym}-15`, 100, 'Transportation');
      await insertTx(`${ym}-15`, 700, 'Grocery');
      await insertTx(`${ym}-15`, 4000, 'Bills');
    }
    await insertTx('2026-06-15', 600, 'Transportation');  // +500, 6x → over
    await insertTx('2026-06-15', 200, 'Grocery');          // -500 → under
    await insertTx('2026-06-15', 4010, 'Bills');           // +10 → typical

    const out = await executeTool('get_scorecard', { window: 'month', year: 2026, month: 6, day: 30 });

    expect(out).toContain('Scorecard — 2026-06 through day 30');
    const overIdx = out.indexOf('OVER');
    const underIdx = out.indexOf('UNDER');
    const typicalIdx = out.indexOf('TYPICAL');
    expect(overIdx).toBeGreaterThan(-1);
    expect(underIdx).toBeGreaterThan(overIdx);
    expect(typicalIdx).toBeGreaterThan(underIdx);

    const section = (from: number, to: number) => out.slice(from, to === -1 ? undefined : to);
    expect(section(overIdx, underIdx)).toContain('Transportation');
    expect(section(overIdx, underIdx)).toContain('+$500 vs typical  (6.0x) 🔴');
    expect(section(underIdx, typicalIdx)).toContain('Grocery');
    expect(section(underIdx, typicalIdx)).toContain('-$500 vs typical  (0.3x) 🟢');
    expect(section(typicalIdx, out.length)).toContain('Bills');
    expect(out).toContain('NET: +$10 vs typical month');
  });

  it('defaults to a trailing 30-day window and flags new spending', async () => {
    await insertTx('2026-06-15', 100, 'Food');

    const out = await executeTool('get_scorecard', { year: 2026, month: 7, day: 3 });

    expect(out).toContain('Scorecard — last 30 days (Jun 4 – Jul 3, 2026)');
    expect(out).toContain('OVER');
    expect(out).toContain('(new) 🔴'); // no baseline history → new spending
  });

  it('reports no data for an empty window', async () => {
    const out = await executeTool('get_scorecard', { year: 2026, month: 7, day: 3 });
    expect(out).toContain('No expense data for last 30 days');
  });
});
