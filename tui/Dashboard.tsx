import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getRangeSummary, getFlexSummary, type MonthlySummary, type FlexSummary } from '../core/queries.js';
import { db } from '../core/db.js';
import {
  getPeriodStart, getPeriodDates, navigatePeriod, formatPeriodLabel,
  RANGES, RANGE_LABELS, type Range,
} from '../core/dateUtils.js';
import type { Screen, TxFilter } from './App.js';

const BAR_WIDTH = 20;

type DashView = 'categories' | 'flex';

function fmt(amount: number) {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(part: number, total: number) {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function bar(amount: number, max: number, width = BAR_WIDTH) {
  const filled = max > 0 ? Math.round((amount / max) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function Divider() {
  return <Text dimColor>{'─'.repeat(60)}</Text>;
}

function getUncategorizedCount(from: string, to: string) {
  return (db.prepare(`
    SELECT COUNT(*) as c FROM transactions
    WHERE category = 'Uncategorized' AND pending = 0 AND ignored = 0
      AND date >= ? AND date <= ?
  `).get(from, to) as { c: number }).c;
}

function getDataBounds() {
  const row = db.prepare(`
    SELECT MIN(date) as minDate, MAX(date) as maxDate
    FROM transactions WHERE pending = 0 AND ignored = 0
  `).get() as { minDate: string | null; maxDate: string | null } | null;
  return {
    minDate: row?.minDate ?? '2000-01-01',
    maxDate: row?.maxDate ?? '2099-12-31',
  };
}

const FLEX_TIERS: Array<{ key: keyof FlexSummary; label: string; color: string }> = [
  { key: 'fixed',         label: 'Fixed',         color: 'red'     },
  { key: 'flexible',      label: 'Flexible',       color: 'yellow'  },
  { key: 'discretionary', label: 'Discretionary',  color: 'cyan'    },
  { key: 'untagged',      label: 'Untagged',       color: 'white'   },
];

export function Dashboard({ onNavigate }: { onNavigate: (s: Screen, filter?: TxFilter) => void }) {
  const now = new Date();
  const [range, setRange] = useState<Range>('month');
  const [anchor, setAnchor] = useState<Date>(() => getPeriodStart('month', now));
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [flexData, setFlexData] = useState<FlexSummary | null>(null);
  const [uncategorized, setUncategorized] = useState(0);
  const [catCursor, setCatCursor] = useState(0);
  const [view, setView] = useState<DashView>('categories');
  const [bounds] = useState(getDataBounds);

  function load(r: Range, a: Date) {
    const { from, to } = getPeriodDates(r, a);
    setSummary(getRangeSummary(from, to));
    setFlexData(getFlexSummary(from, to));
    setUncategorized(getUncategorizedCount(from, to));
  }

  useEffect(() => { load(range, anchor); setCatCursor(0); }, [range, anchor.toISOString().slice(0, 10)]);

  const categories = summary?.byCategory ?? [];

  useInput((input, key) => {
    if (key.leftArrow && range !== 'alltime') {
      const next = navigatePeriod(range, anchor, -1);
      const { from } = getPeriodDates(range, next);
      if (from >= bounds.minDate) setAnchor(next);
      return;
    }
    if (key.rightArrow && range !== 'alltime') {
      const next = navigatePeriod(range, anchor, 1);
      const { from } = getPeriodDates(range, next);
      if (from <= bounds.maxDate) setAnchor(next);
      return;
    }
    if (key.upArrow && view === 'categories') { setCatCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow && view === 'categories') { setCatCursor((c) => Math.min(categories.length - 1, c + 1)); return; }
    if (key.return && view === 'categories') {
      const cat = categories[catCursor];
      if (cat) {
        const { from, to } = getPeriodDates(range, anchor);
        onNavigate('transactions', { category: cat.category, from, to });
      }
      return;
    }
    if (key.return && view === 'flex') {
      const { from, to } = getPeriodDates(range, anchor);
      onNavigate('transactions', { from, to });
      return;
    }
    if (input === 'r') {
      const idx = RANGES.indexOf(range);
      const next = RANGES[(idx + 1) % RANGES.length];
      setRange(next);
      setAnchor(getPeriodStart(next, now));
      setCatCursor(0);
      return;
    }
    if (input === 'f') { setView((v) => v === 'categories' ? 'flex' : 'categories'); return; }
    if (input === 't') {
      const cat = view === 'categories' ? categories[catCursor] : null;
      onNavigate('trends', cat ? { category: cat.category } : {});
      return;
    }
    if (input === '2') onNavigate('transactions');
    if (input === '3') onNavigate('rules');
    if (input === '4') onNavigate('import');
    if (input === '5') onNavigate('tags');
  });

  const maxCategorySpend = categories[0]?.total ?? 1;
  const totalExpenses = summary?.expenses ?? 0;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[2] txns  [3] rules  [4] import  [5] tags</Text>
      </Box>

      <Box gap={2} marginTop={1}>
        {RANGES.map((r) => (
          <Text key={r} color={r === range ? 'cyan' : undefined} dimColor={r !== range} bold={r === range}>
            {RANGE_LABELS[r]}
          </Text>
        ))}
        <Text dimColor>  [r] cycle</Text>
      </Box>

      <Box justifyContent="space-between" marginTop={1} marginBottom={1}>
        <Box gap={3}>
          <Text bold>{formatPeriodLabel(range, anchor)}</Text>
          <Text color={view === 'categories' ? 'white' : 'cyan'} dimColor={view !== 'flex'}>[f] {view === 'flex' ? 'flexibility' : 'flexibility'}</Text>
        </Box>
        <Text dimColor>
          {view === 'categories'
            ? '← → period  ·  ↑↓ select  ·  Enter txns  ·  [t] trends'
            : '← → period  ·  Enter txns'}
        </Text>
      </Box>

      <Divider />

      {summary ? (
        <>
          <Box gap={6} marginY={1}>
            <Box flexDirection="column">
              <Text dimColor>Income</Text>
              <Text color="green" bold>{fmt(summary.income)}</Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>Expenses</Text>
              <Text color="red" bold>{fmt(summary.expenses)}</Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>Net</Text>
              <Text color={summary.net >= 0 ? 'green' : 'red'} bold>
                {summary.net >= 0 ? '+' : '-'}{fmt(summary.net)}
              </Text>
            </Box>
            {uncategorized > 0 && (
              <Box flexDirection="column">
                <Text dimColor>Uncategorized</Text>
                <Text color="yellow" bold>{uncategorized} txns</Text>
              </Box>
            )}
          </Box>

          <Divider />

          {view === 'categories' ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>SPENDING BY CATEGORY</Text>
              <Box flexDirection="column" marginTop={1}>
                {categories.length === 0 ? (
                  <Text dimColor>No expense data for this period.</Text>
                ) : (
                  categories.map((row, i) => {
                    const isSelected = catCursor === i;
                    return (
                      <Box key={`${row.category}-${i}`} gap={2}>
                        <Text color={isSelected ? 'cyan' : undefined}>
                          {isSelected ? '▶ ' : '  '}
                          {row.category.padEnd(20)}
                        </Text>
                        <Text color="yellow">{fmt(row.total).padStart(10)}</Text>
                        <Text color="cyan" dimColor={!isSelected}>
                          {bar(row.total, maxCategorySpend)}
                        </Text>
                      </Box>
                    );
                  })
                )}
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>SPENDING BY FLEXIBILITY</Text>
              <Box flexDirection="column" marginTop={1}>
                {flexData && FLEX_TIERS.map(({ key, label, color }) => {
                  const amount = flexData[key];
                  if (amount === 0) return null;
                  return (
                    <Box key={key} gap={2}>
                      <Text color={color}>{'  '}{label.padEnd(16)}</Text>
                      <Text color="yellow">{fmt(amount).padStart(10)}</Text>
                      <Text dimColor>{pct(amount, totalExpenses).padStart(4)}</Text>
                      <Text color={color}>{bar(amount, totalExpenses, 16)}</Text>
                    </Box>
                  );
                })}
              </Box>
              {flexData && flexData.untagged > 0 && (
                <Text dimColor marginTop={1}>
                  {pct(flexData.untagged, totalExpenses)} untagged — set tiers in Rules → Categories
                </Text>
              )}
            </Box>
          )}
        </>
      ) : (
        <Text dimColor>Loading...</Text>
      )}
    </Box>
  );
}
