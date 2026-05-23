import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getMonthlySummary, type MonthlySummary } from '../core/queries.js';
import { syncAll } from '../core/sync.js';
import { db } from '../core/db.js';
import type { Screen, TxFilter } from './App.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR_WIDTH = 20;

function fmt(amount: number) {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bar(amount: number, max: number) {
  const filled = Math.round((amount / max) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

function Divider() {
  return <Text dimColor>{'─'.repeat(60)}</Text>;
}

function getUncategorizedCount(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to   = `${year}-${String(month).padStart(2, '0')}-31`;
  return (db.prepare(`
    SELECT COUNT(*) as c FROM transactions
    WHERE category = 'Uncategorized' AND date >= ? AND date <= ?
  `).get(from, to) as { c: number }).c;
}

type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

function getDataBounds() {
  const row = db.prepare(`
    SELECT
      CAST(substr(MIN(date), 1, 4) AS INTEGER) as minYear,
      CAST(substr(MIN(date), 6, 2) AS INTEGER) as minMonth,
      CAST(substr(MAX(date), 1, 4) AS INTEGER) as maxYear,
      CAST(substr(MAX(date), 6, 2) AS INTEGER) as maxMonth
    FROM transactions WHERE pending = 0 AND ignored = 0
  `).get() as { minYear: number; minMonth: number; maxYear: number; maxMonth: number } | null;
  return row ?? { minYear: 2020, minMonth: 1, maxYear: 2099, maxMonth: 12 };
}

export function Dashboard({ onNavigate }: { onNavigate: (s: Screen, filter?: TxFilter) => void }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [uncategorized, setUncategorized] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const [catCursor, setCatCursor] = useState(0);
  const [bounds] = useState(getDataBounds);

  function load() {
    setSummary(getMonthlySummary(year, month));
    setUncategorized(getUncategorizedCount(year, month));
  }

  useEffect(() => { load(); setCatCursor(0); }, [month, year]);

  const categories = summary?.byCategory ?? [];

  useInput((input, key) => {
    if (key.leftArrow) {
      const prevM = month === 1 ? 12 : month - 1;
      const prevY = month === 1 ? year - 1 : year;
      if (prevY > bounds.minYear || (prevY === bounds.minYear && prevM >= bounds.minMonth)) {
        setYear(prevY); setMonth(prevM);
      }
    }
    if (key.rightArrow) {
      const nextM = month === 12 ? 1 : month + 1;
      const nextY = month === 12 ? year + 1 : year;
      if (nextY < bounds.maxYear || (nextY === bounds.maxYear && nextM <= bounds.maxMonth)) {
        setYear(nextY); setMonth(nextM);
      }
    }
    if (key.upArrow) setCatCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCatCursor((c) => Math.min(categories.length - 1, c + 1));
    if (key.return) {
      const cat = categories[catCursor];
      if (cat) onNavigate('transactions', { category: cat.category, month, year });
    }
    if (input === 't') {
      const cat = categories[catCursor];
      onNavigate('trends', cat ? { category: cat.category } : {});
    }
    if (input === 's') {
      setSyncStatus('syncing');
      setSyncMsg('Syncing...');
      syncAll()
        .then((results) => {
          const total = results.reduce((s, r) => s + r.added + r.modified, 0);
          setSyncStatus('done');
          setSyncMsg(`Synced ${total} transactions`);
          load();
          setTimeout(() => setSyncStatus('idle'), 3000);
        })
        .catch((e) => {
          setSyncStatus('error');
          setSyncMsg(`Error: ${e.message}`);
        });
    }
    if (input === '2') onNavigate('transactions');
    if (input === '3') onNavigate('rules');
    if (input === '4') onNavigate('import');
  });

  const maxCategorySpend = categories[0]?.total ?? 1;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[2] txns  [3] rules  [4] import</Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1} marginBottom={1}>
        <Text bold>{MONTHS[month - 1]} {year}</Text>
        <Text dimColor>← → month  ·  ↑↓ select  ·  Enter txns  ·  [t] trends  ·  [s] sync</Text>
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

          <Box flexDirection="column" marginTop={1}>
            <Text bold dimColor>SPENDING BY CATEGORY</Text>
            <Box flexDirection="column" marginTop={1}>
              {categories.length === 0 ? (
                <Text dimColor>No expense data for this month.</Text>
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
                      <Text color={isSelected ? 'cyan' : 'cyan'} dimColor={!isSelected}>
                        {bar(row.total, maxCategorySpend)}
                      </Text>
                    </Box>
                  );
                })
              )}
            </Box>
          </Box>
        </>
      ) : (
        <Text dimColor>Loading...</Text>
      )}

      {syncStatus !== 'idle' && (
        <Box marginTop={1}>
          <Text color={syncStatus === 'error' ? 'red' : syncStatus === 'done' ? 'green' : 'yellow'}>
            {syncMsg}
          </Text>
        </Box>
      )}
    </Box>
  );
}
