import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getMonthlySummary, getTagSummary, type MonthlySummary } from '../core/queries.js';
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

type DashView = 'categories' | 'tags';

type TagRow = { name: string; spent: number };

function getTagTotals(): TagRow[] {
  return db.prepare(`
    SELECT tg.name,
      SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) as spent
    FROM tags tg
    JOIN transaction_tags tt ON tt.tag_id = tg.id
    JOIN transactions t ON t.id = tt.transaction_id
    WHERE t.ignored = 0
    GROUP BY tg.id, tg.name
    ORDER BY spent DESC
  `).all() as TagRow[];
}

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
  const [catCursor, setCatCursor] = useState(0);
  const [bounds] = useState(getDataBounds);
  const [view, setView] = useState<DashView>('categories');
  const [tagRows, setTagRows] = useState<TagRow[]>([]);
  const [tagCursor, setTagCursor] = useState(0);
  const [tagSummary, setTagSummary] = useState<MonthlySummary | null>(null);
  const [tagCatCursor, setTagCatCursor] = useState(0);

  function load() {
    setSummary(getMonthlySummary(year, month));
    setUncategorized(getUncategorizedCount(year, month));
    const tags = getTagTotals();
    setTagRows(tags);
    if (tags.length > 0) setTagSummary(getTagSummary(tags[tagCursor]?.name ?? tags[0].name));
  }

  useEffect(() => { load(); setCatCursor(0); }, [month, year]);

  const categories = summary?.byCategory ?? [];

  useInput((input, key) => {
    if (input === 'g') { setView((v) => v === 'categories' ? 'tags' : 'categories'); return; }

    if (view === 'tags') {
      if (key.leftArrow) {
        const next = Math.max(0, tagCursor - 1);
        setTagCursor(next);
        if (tagRows[next]) setTagSummary(getTagSummary(tagRows[next].name));
        setTagCatCursor(0);
        return;
      }
      if (key.rightArrow) {
        const next = Math.min(tagRows.length - 1, tagCursor + 1);
        setTagCursor(next);
        if (tagRows[next]) setTagSummary(getTagSummary(tagRows[next].name));
        setTagCatCursor(0);
        return;
      }
      if (key.upArrow) { setTagCatCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setTagCatCursor((c) => Math.min((tagSummary?.byCategory.length ?? 1) - 1, c + 1)); return; }
      if (key.return) {
        const cat = tagSummary?.byCategory[tagCatCursor];
        onNavigate('transactions', { tag: tagRows[tagCursor]?.name, category: cat?.category });
        return;
      }
    } else {
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
    }
    if (input === '2') onNavigate('transactions');
    if (input === '3') onNavigate('rules');
    if (input === '4') onNavigate('import');
    if (input === '5') onNavigate('tags');
  });

  const maxCategorySpend = categories[0]?.total ?? 1;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[2] txns  [3] rules  [4] import  [5] tags</Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1} marginBottom={1}>
        {view === 'tags' && tagRows.length > 0
          ? <Text bold># {tagRows[tagCursor]?.name} <Text dimColor>← {tagCursor + 1} / {tagRows.length} →</Text></Text>
          : view === 'tags' ? <Text bold>Tags</Text>
          : <Text bold>{MONTHS[month - 1]} {year}</Text>
        }
        {view === 'categories'
          ? <Text dimColor>← → month  ·  ↑↓ select  ·  Enter txns  ·  [t] trends  ·  [g] tags</Text>
          : <Text dimColor>← → tag  ·  ↑↓ category  ·  Enter txns  ·  [g] month</Text>
        }
      </Box>

      <Divider />

      {view === 'tags' ? (
        tagRows.length === 0 ? (
          <Text dimColor>No tags yet. Create from [5] or press [g] on a transaction.</Text>
        ) : tagSummary ? (
          <>
            <Box gap={6} marginY={1}>
              <Box flexDirection="column">
                <Text dimColor>Income</Text>
                <Text color="green" bold>{fmt(tagSummary.income)}</Text>
              </Box>
              <Box flexDirection="column">
                <Text dimColor>Expenses</Text>
                <Text color="red" bold>{fmt(tagSummary.expenses)}</Text>
              </Box>
              <Box flexDirection="column">
                <Text dimColor>Net</Text>
                <Text color={tagSummary.net >= 0 ? 'green' : 'red'} bold>
                  {tagSummary.net >= 0 ? '+' : '-'}{fmt(tagSummary.net)}
                </Text>
              </Box>
            </Box>

            <Divider />

            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>SPENDING BY CATEGORY</Text>
              <Box flexDirection="column" marginTop={1}>
                {tagSummary.byCategory.length === 0 ? (
                  <Text dimColor>No expense data for this tag.</Text>
                ) : (
                  tagSummary.byCategory.map((row, i) => {
                    const isSelected = tagCatCursor === i;
                    const maxSpend = tagSummary.byCategory[0]?.total ?? 1;
                    return (
                      <Box key={row.category} gap={2}>
                        <Text color={isSelected ? 'cyan' : undefined}>
                          {isSelected ? '▶ ' : '  '}
                          {row.category.padEnd(20)}
                        </Text>
                        <Text color="yellow">{fmt(row.total).padStart(10)}</Text>
                        <Text color="cyan" dimColor={!isSelected}>{bar(row.total, maxSpend)}</Text>
                      </Box>
                    );
                  })
                )}
              </Box>
            </Box>
          </>
        ) : null
      ) : summary ? (
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

    </Box>
  );
}
