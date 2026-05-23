import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import type { Screen, TxFilter } from './App.js';

const BAR_WIDTH = 28;
const HALF_BAR = 14;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type TrendsRange = 'week' | 'month' | 'quarter' | 'year';
const TRENDS_RANGES: TrendsRange[] = ['week', 'month', 'quarter', 'year'];
const RANGE_LABELS: Record<TrendsRange, string> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

type FlexTier = 'fixed' | 'flexible' | 'discretionary';
type ViewMode = 'expenses' | 'income' | 'net' | 'category' | 'flex';

type View = {
  mode: ViewMode;
  category: string | null;
  flex: FlexTier | null;
  label: string;
};

type PeriodRow = {
  label: string; from: string; to: string;
  total: number;
  income?: number; expenses?: number; // net mode only
};

const FLEX_COLORS: Record<FlexTier, string> = { fixed: 'red', flexible: 'yellow', discretionary: 'cyan' };

function buildViews(): View[] {
  const cats = db.prepare(`
    SELECT t.category, SUM(t.amount) as total
    FROM transactions t
    WHERE t.pending = 0 AND t.ignored = 0 AND t.amount > 0
      AND t.category NOT IN (SELECT category FROM hidden_categories)
    GROUP BY t.category
    ORDER BY total DESC
  `).all() as { category: string }[];

  return [
    { mode: 'expenses',      category: null, flex: null,            label: 'Expenses'      },
    { mode: 'income',        category: null, flex: null,            label: 'Income'        },
    { mode: 'net',           category: null, flex: null,            label: 'Net'           },
    { mode: 'flex',          category: null, flex: 'fixed',         label: 'Fixed'         },
    { mode: 'flex',          category: null, flex: 'flexible',      label: 'Flexible'      },
    { mode: 'flex',          category: null, flex: 'discretionary', label: 'Discretionary' },
    ...cats.map((r) => ({ mode: 'category' as ViewMode, category: r.category, flex: null, label: r.category })),
  ];
}

function fmt(amount: number) {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSigned(amount: number) {
  return `${amount >= 0 ? '+' : '-'}$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bar(amount: number, max: number, width = BAR_WIDTH) {
  const filled = max > 0 ? Math.min(width, Math.max(0, Math.round((Math.abs(amount) / max) * width))) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekLabel(from: string, to: string): string {
  const d1 = new Date(from + 'T12:00:00');
  const d2 = new Date(to + 'T12:00:00');
  const m1 = MONTHS[d1.getMonth()]; const m2 = MONTHS[d2.getMonth()];
  if (m1 === m2) return `${m1} ${d1.getDate()}–${d2.getDate()} ${d1.getFullYear()}`;
  if (d1.getFullYear() === d2.getFullYear()) return `${m1} ${d1.getDate()} – ${m2} ${d2.getDate()} ${d1.getFullYear()}`;
  return `${m1} ${d1.getDate()} ${d1.getFullYear()} – ${m2} ${d2.getDate()} ${d2.getFullYear()}`;
}

function buildPeriodRows<T extends { total: number }>(
  range: TrendsRange,
  rawRows: T[],
  toLabel: (r: T) => string,
  toFrom: (r: T) => string,
  toTo: (r: T) => string,
  extras: (r: T) => Partial<PeriodRow> = () => ({}),
): PeriodRow[] {
  return rawRows.map((r) => ({
    label: toLabel(r), from: toFrom(r), to: toTo(r), total: r.total, ...extras(r),
  }));
}

function getPeriodTotals(view: View, range: TrendsRange): PeriodRow[] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const qFrom = ['01', '04', '07', '10'];
  const qTo   = ['03', '06', '09', '12'];

  // Build filter clauses
  const catFilter = view.category
    ? `AND t.category = '${view.category.replace(/'/g, "''")}'`
    : view.flex
    ? `AND EXISTS (SELECT 1 FROM categories c WHERE c.name = t.category AND c.flexibility = '${view.flex}')`
    : 'AND t.category NOT IN (SELECT category FROM hidden_categories)';

  const amtFilter = view.mode === 'income' ? 'AND t.amount < 0' :
                    view.mode === 'net'     ? '' : 'AND t.amount > 0';

  const base = `FROM transactions t WHERE t.pending = 0 AND t.ignored = 0 ${amtFilter} ${catFilter}`;

  // For net mode: return income and expenses separately for the diverging bar
  const isNet = view.mode === 'net';
  const totalExpr = isNet
    ? 'SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as income, SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) as expenses, SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE -t.amount END) as total'
    : 'SUM(ABS(t.amount)) as total';

  if (range === 'month') {
    const rows = db.prepare(`
      SELECT CAST(substr(t.date,1,4) AS INTEGER) as y, CAST(substr(t.date,6,2) AS INTEGER) as m, ${totalExpr}
      ${base} GROUP BY y, m ORDER BY y, m
    `).all() as any[];
    return rows.map((r) => ({
      label: `${MONTHS[r.m - 1]} ${r.y}`,
      from: `${r.y}-${pad(r.m)}-01`, to: `${r.y}-${pad(r.m)}-31`,
      total: r.total, ...(isNet ? { income: r.income, expenses: r.expenses } : {}),
    }));
  }

  if (range === 'quarter') {
    const rows = db.prepare(`
      SELECT CAST(substr(t.date,1,4) AS INTEGER) as y, (CAST(substr(t.date,6,2) AS INTEGER)-1)/3+1 as q, ${totalExpr}
      ${base} GROUP BY y, q ORDER BY y, q
    `).all() as any[];
    return rows.map((r) => ({
      label: `Q${r.q} ${r.y}`,
      from: `${r.y}-${qFrom[r.q - 1]}-01`, to: `${r.y}-${qTo[r.q - 1]}-31`,
      total: r.total, ...(isNet ? { income: r.income, expenses: r.expenses } : {}),
    }));
  }

  if (range === 'year') {
    const rows = db.prepare(`
      SELECT CAST(substr(t.date,1,4) AS INTEGER) as y, ${totalExpr}
      ${base} GROUP BY y ORDER BY y
    `).all() as any[];
    return rows.map((r) => ({
      label: `${r.y}`,
      from: `${r.y}-01-01`, to: `${r.y}-12-31`,
      total: r.total, ...(isNet ? { income: r.income, expenses: r.expenses } : {}),
    }));
  }

  // week
  const rows = db.prepare(`
    SELECT date(t.date, '-' || ((CAST(strftime('%w', t.date) AS INTEGER)+6)%7) || ' days') as week_start, ${totalExpr}
    ${base} GROUP BY week_start ORDER BY week_start
  `).all() as any[];
  return rows.map((r) => {
    const to = addDays(r.week_start, 6);
    return {
      label: weekLabel(r.week_start, to), from: r.week_start, to,
      total: r.total, ...(isNet ? { income: r.income, expenses: r.expenses } : {}),
    };
  });
}

function viewColor(view: View): string {
  if (view.mode === 'net')    return 'cyan';
  if (view.mode === 'income') return 'green';
  if (view.mode === 'flex' && view.flex) return FLEX_COLORS[view.flex];
  return 'red';
}

export function Trends({
  onNavigate,
  initialFilter,
}: {
  onNavigate: (s: Screen, f?: TxFilter) => void;
  initialFilter?: TxFilter;
}) {
  const [views] = useState<View[]>(buildViews);
  const [viewIdx, setViewIdx] = useState(() => {
    const cat = initialFilter?.category ?? null;
    if (!cat) return 0;
    const idx = views.findIndex((v) => v.category === cat);
    return idx >= 0 ? idx : 0;
  });
  const [range, setRange] = useState<TrendsRange>('month');
  const [rows, setRows] = useState<PeriodRow[]>([]);
  const [cursor, setCursor] = useState(0);

  const view = views[viewIdx] ?? views[0];
  const isNet = view.mode === 'net';

  useEffect(() => {
    const data = getPeriodTotals(view, range);
    setRows(data);
    setCursor(Math.max(0, data.length - 1));
  }, [viewIdx, range]);

  useInput((input, key) => {
    if (key.escape) { onNavigate('dashboard'); return; }
    if (input === '1') { onNavigate('dashboard'); return; }
    if (input === '2') { onNavigate('transactions'); return; }
    if (input === '3') { onNavigate('rules'); return; }
    if (input === '4') { onNavigate('import'); return; }
    if (input === '5') { onNavigate('tags'); return; }
    if (key.leftArrow)  { setViewIdx((i) => (i - 1 + views.length) % views.length); return; }
    if (key.rightArrow) { setViewIdx((i) => (i + 1) % views.length); return; }
    if (key.upArrow)   { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor((c) => Math.min(rows.length - 1, c + 1)); return; }
    if (input === 'r') {
      setRange((r) => TRENDS_RANGES[(TRENDS_RANGES.indexOf(r) + 1) % TRENDS_RANGES.length]);
      return;
    }
    if (key.return) {
      const row = rows[cursor];
      if (row) onNavigate('transactions', { category: view.category ?? undefined, from: row.from, to: row.to });
    }
  });

  const PAGE = 30;
  const pageStart = Math.max(0, Math.min(cursor - Math.floor(PAGE / 2), rows.length - PAGE));
  const visible = rows.slice(pageStart, pageStart + PAGE);

  // For net diverging bar: scale both sides against the same max
  const maxIncome   = isNet ? Math.max(...rows.map((r) => r.income   ?? 0), 1) : 1;
  const maxExpenses = isNet ? Math.max(...rows.map((r) => r.expenses ?? 0), 1) : 1;
  const netMax = Math.max(maxIncome, maxExpenses);

  const absMax = isNet ? netMax : Math.max(...rows.map((r) => Math.abs(r.total)), 1);

  const avg  = rows.length ? rows.reduce((s, r) => s + r.total, 0) / rows.length : 0;
  const peak = rows.reduce((best, r) => Math.abs(r.total) > Math.abs(best?.total ?? 0) ? r : best, rows[0]);

  const labelWidth = range === 'week' ? 22 : range === 'month' ? 10 : range === 'quarter' ? 8 : 6;
  const color = viewColor(view);
  const posLabel = `${viewIdx + 1} / ${views.length}`;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [2] txns  [3] rules  [4] import  [5] tags</Text>
      </Box>

      <Box gap={2} marginTop={1}>
        {TRENDS_RANGES.map((r) => (
          <Text key={r} color={r === range ? 'cyan' : undefined} dimColor={r !== range} bold={r === range}>
            {RANGE_LABELS[r]}
          </Text>
        ))}
        <Text dimColor>  [r] cycle</Text>
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Box gap={2}>
          <Text bold color={color}>{view.label}</Text>
          <Text dimColor>← {posLabel} →</Text>
        </Box>
        <Text dimColor>← → view  ·  ↑↓ navigate  ·  Enter drill in</Text>
      </Box>
      <Text dimColor marginTop={1}>{'─'.repeat(70)}</Text>

      {rows.length === 0 ? (
        <Text dimColor marginTop={1}>No data.</Text>
      ) : (
        <>
          <Box flexDirection="column" marginTop={1}>
            {isNet && (
              <Box gap={1} marginBottom={1}>
                <Text dimColor>{' '.repeat(2 + labelWidth)}</Text>
                <Text dimColor>{''.padStart(13)}</Text>
                <Text color="red" dimColor>{'expenses ←'.padStart(HALF_BAR)}</Text>
                <Text dimColor>{'|'}</Text>
                <Text color="green">{'→ income'}</Text>
              </Box>
            )}
            {visible.map((row, i) => {
              const isSelected = rows[pageStart + i] === rows[cursor];

              if (isNet && row.income !== undefined && row.expenses !== undefined) {
                const expFilled = Math.min(HALF_BAR, Math.max(0, Math.round((row.expenses / netMax) * HALF_BAR)));
                const incFilled = Math.min(HALF_BAR, Math.max(0, Math.round((row.income  / netMax) * HALF_BAR)));
                const leftBar  = '░'.repeat(HALF_BAR - expFilled) + '█'.repeat(expFilled);
                const rightBar = '█'.repeat(incFilled) + '░'.repeat(HALF_BAR - incFilled);
                const net = row.income - row.expenses;
                return (
                  <Box key={row.from} gap={1}>
                    <Text color={isSelected ? 'cyan' : undefined}>
                      {isSelected ? '▶ ' : '  '}{row.label.padEnd(labelWidth)}
                    </Text>
                    <Text color={net >= 0 ? 'green' : 'red'} dimColor={!isSelected}>
                      {fmtSigned(net).padStart(13)}
                    </Text>
                    <Text color="red"   dimColor={!isSelected}>{leftBar}</Text>
                    <Text dimColor>|</Text>
                    <Text color="green" dimColor={!isSelected}>{rightBar}</Text>
                  </Box>
                );
              }

              return (
                <Box key={row.from} gap={2}>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '▶ ' : '  '}{row.label.padEnd(labelWidth)}
                  </Text>
                  <Text color={isSelected ? 'white' : undefined} dimColor={!isSelected}>
                    {fmt(row.total).padStart(13)}
                  </Text>
                  <Text color={color} dimColor={!isSelected}>
                    {bar(row.total, absMax)}
                  </Text>
                </Box>
              );
            })}
          </Box>

          <Text dimColor marginTop={1}>{'─'.repeat(70)}</Text>
          <Box gap={6} marginTop={1}>
            <Box flexDirection="column">
              <Text dimColor>periods</Text>
              <Text bold>{rows.length}</Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>avg/{RANGE_LABELS[range].toLowerCase()}</Text>
              <Text bold color={isNet ? (avg >= 0 ? 'green' : 'red') : undefined}>
                {isNet ? fmtSigned(avg) : fmt(avg)}
              </Text>
            </Box>
            {peak && (
              <Box flexDirection="column">
                <Text dimColor>peak</Text>
                <Text bold>
                  {peak.label}{' '}
                  <Text dimColor>{isNet ? fmtSigned(peak.total) : fmt(peak.total)}</Text>
                </Text>
              </Box>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
