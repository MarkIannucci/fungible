import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import type { Screen, TxFilter } from './App.js';

const BAR_WIDTH = 28;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type ViewMode = 'expenses' | 'income' | 'net' | 'category';

type View = {
  mode: ViewMode;
  category: string | null;
  label: string;
};

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
    { mode: 'expenses', category: null, label: 'Expenses' },
    { mode: 'income',   category: null, label: 'Income' },
    { mode: 'net',      category: null, label: 'Net' },
    ...cats.map((r) => ({ mode: 'category' as ViewMode, category: r.category, label: r.category })),
  ];
}

function fmt(amount: number) {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNet(amount: number) {
  const sign = amount >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bar(amount: number, max: number) {
  const filled = max > 0 ? Math.round((Math.abs(amount) / max) * BAR_WIDTH) : 0;
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

type MonthRow = { year: number; month: number; total: number };

function getMonthlyTotals(view: View): MonthRow[] {
  const categoryClause = view.category
    ? 'AND t.category = ?'
    : 'AND t.category NOT IN (SELECT category FROM hidden_categories)';
  const args: (string | number)[] = view.category ? [view.category] : [];

  if (view.mode === 'net') {
    return db.prepare(`
      SELECT
        CAST(substr(t.date, 1, 4) AS INTEGER) as year,
        CAST(substr(t.date, 6, 2) AS INTEGER) as month,
        SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE -t.amount END) as total
      FROM transactions t
      WHERE t.pending = 0 AND t.ignored = 0
        ${categoryClause}
      GROUP BY year, month
      ORDER BY year ASC, month ASC
    `).all(...args) as MonthRow[];
  }

  const amountClause = (view.mode === 'expenses' || view.mode === 'category')
    ? 't.amount > 0'
    : 't.amount < 0';

  return db.prepare(`
    SELECT
      CAST(substr(t.date, 1, 4) AS INTEGER) as year,
      CAST(substr(t.date, 6, 2) AS INTEGER) as month,
      SUM(ABS(t.amount)) as total
    FROM transactions t
    WHERE t.pending = 0 AND t.ignored = 0
      AND ${amountClause}
      ${categoryClause}
    GROUP BY year, month
    ORDER BY year ASC, month ASC
  `).all(...args) as MonthRow[];
}

function barColor(view: View, row: MonthRow): string {
  if (view.mode === 'net') return row.total >= 0 ? 'green' : 'red';
  if (view.mode === 'income') return 'green';
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
  const [rows, setRows] = useState<MonthRow[]>([]);
  const [cursor, setCursor] = useState(0);

  const view = views[viewIdx] ?? views[0];

  useEffect(() => {
    const data = getMonthlyTotals(view);
    setRows(data);
    setCursor(Math.max(0, data.length - 1));
  }, [viewIdx]);

  const absMax = Math.max(...rows.map((r) => Math.abs(r.total)), 1);

  useInput((input, key) => {
    if (key.escape) { onNavigate('dashboard'); return; }
    if (input === '1') { onNavigate('dashboard'); return; }
    if (input === '2') { onNavigate('transactions'); return; }
    if (input === '3') { onNavigate('rules'); return; }
    if (input === '4') { onNavigate('import'); return; }
    if (input === '5') { onNavigate('tags'); return; }
    if (key.leftArrow)  { setViewIdx((i) => (i - 1 + views.length) % views.length); return; }
    if (key.rightArrow) { setViewIdx((i) => (i + 1) % views.length); return; }
    if (key.upArrow)   setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(rows.length - 1, c + 1));
    if (key.return) {
      const row = rows[cursor];
      if (row) onNavigate('transactions', { category: view.category ?? undefined, month: row.month, year: row.year });
    }
  });

  const PAGE = 30;
  const pageStart = Math.max(0, Math.min(cursor - Math.floor(PAGE / 2), rows.length - PAGE));
  const visible = rows.slice(pageStart, pageStart + PAGE);

  const avg = rows.length ? rows.reduce((s, r) => s + r.total, 0) / rows.length : 0;
  const peak = rows.reduce((best, r) => Math.abs(r.total) > Math.abs(best.total) ? r : best, rows[0]);
  const isNet = view.mode === 'net';

  // Position indicator: e.g. "2 / 14"
  const posLabel = `${viewIdx + 1} / ${views.length}`;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [2] txns  [3] rules  [4] import  [5] tags</Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Box gap={2}>
          <Text bold color={isNet ? 'cyan' : view.mode === 'income' ? 'green' : 'red'}>
            {view.label}
          </Text>
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
            {visible.map((row, i) => {
              const isSelected = rows[pageStart + i] === rows[cursor];
              return (
                <Box key={`${row.year}-${row.month}`} gap={2}>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '▶ ' : '  '}
                    {MONTHS[row.month - 1]} {row.year}
                  </Text>
                  <Text color={isSelected ? 'white' : undefined} dimColor={!isSelected}>
                    {(isNet ? fmtNet(row.total) : fmt(row.total)).padStart(13)}
                  </Text>
                  <Text color={barColor(view, row)} dimColor={!isSelected}>
                    {bar(row.total, absMax)}
                  </Text>
                </Box>
              );
            })}
          </Box>

          <Text dimColor marginTop={1}>{'─'.repeat(70)}</Text>
          <Box gap={6} marginTop={1}>
            <Box flexDirection="column">
              <Text dimColor>months</Text>
              <Text bold>{rows.length}</Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>avg/month</Text>
              <Text bold color={isNet ? (avg >= 0 ? 'green' : 'red') : undefined}>
                {isNet ? fmtNet(avg) : fmt(avg)}
              </Text>
            </Box>
            {peak && (
              <Box flexDirection="column">
                <Text dimColor>peak</Text>
                <Text bold>
                  {MONTHS[peak.month - 1]} {peak.year}{' '}
                  <Text dimColor>{isNet ? fmtNet(peak.total) : fmt(peak.total)}</Text>
                </Text>
              </Box>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
