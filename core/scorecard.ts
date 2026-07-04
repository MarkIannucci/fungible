import type { CategoryDrift } from './queries.js';

// Pure bucketing of drift rows into a scorecard verdict. Kept free of DB and
// UI imports so the GUI renderer can import it directly (no bridge needed).

export type Scorecard = {
  over: CategoryDrift[];    // significantly above baseline, worst first
  typical: CategoryDrift[]; // within the noise band, input order preserved
  under: CategoryDrift[];   // significantly below baseline, biggest saving last
  net: number;              // sum of medianDelta across ALL rows (incl. typical)
};

// A delta only counts as signal when it clears both an absolute floor and a
// share of the category's own baseline — $40 over on a $60 baseline matters,
// $40 over on a $4,000 baseline doesn't.
export const SIGNIFICANCE_FLOOR = 50;
export const SIGNIFICANCE_SHARE = 0.15;

export function isSignificantDelta(delta: number, baseline: number): boolean {
  return Math.abs(delta) >= Math.max(SIGNIFICANCE_FLOOR, SIGNIFICANCE_SHARE * baseline);
}

/** "4.2x" multiplier vs baseline; "new" when there is no baseline to compare. */
export function ratioLabel(current: number, baseline: number): string {
  if (baseline <= 0) return current > 0 ? 'new' : '';
  return `${(current / baseline).toFixed(1)}x`;
}

export function bucketDrift(rows: CategoryDrift[]): Scorecard {
  const over: CategoryDrift[] = [];
  const typical: CategoryDrift[] = [];
  const under: CategoryDrift[] = [];
  let net = 0;
  for (const row of rows) {
    net += row.medianDelta;
    if (!isSignificantDelta(row.medianDelta, row.median12m)) typical.push(row);
    else if (row.medianDelta > 0) over.push(row);
    else under.push(row);
  }
  over.sort((a, b) => b.medianDelta - a.medianDelta);
  // Ascending magnitude so the biggest saving sits last — extremes at the
  // visual edges of the OVER…UNDER stack.
  under.sort((a, b) => b.medianDelta - a.medianDelta);
  return { over, typical, under, net };
}
