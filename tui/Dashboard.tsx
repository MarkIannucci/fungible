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

type DashView = 'categories' | 'flex' | 'account';

function fmt(amount: number) {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtInt(n: number) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pct(part: number, total: number) {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function bar(amount: number, max: number, width = BAR_WIDTH) {
  const filled = max > 0 ? Math.min(width, Math.round((amount / max) * width)) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function Divider() {
  return <Text dimColor>{'─'.repeat(60)}</Text>;
}

function getUncategorizedCount(from: string, to: string, accountId?: string) {
  const where = accountId ? 'AND account_id = ?' : '';
  const args = accountId ? [from, to, accountId] : [from, to];
  return (db.prepare(`
    SELECT COUNT(*) as c FROM transactions
    WHERE category = 'Uncategorized' AND pending = 0 AND ignored = 0
      AND date >= ? AND date <= ? ${where}
  `).get(...args) as { c: number }).c;
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

function getFilteredRangeSummary(from: string, to: string, accountId: string): MonthlySummary {
  const row = db.prepare(`
    SELECT
      COALESCE(-SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as expenses
    FROM transactions
    WHERE date >= ? AND date <= ? AND account_id = ?
      AND pending = 0 AND ignored = 0
      AND category NOT IN (SELECT category FROM hidden_categories)
  `).get(from, to, accountId) as { income: number; expenses: number };

  const byCategory = db.prepare(`
    SELECT category, SUM(amount) as total
    FROM transactions
    WHERE date >= ? AND date <= ? AND account_id = ?
      AND amount > 0 AND pending = 0 AND ignored = 0
      AND category NOT IN (SELECT category FROM hidden_categories)
    GROUP BY category ORDER BY total DESC
  `).all(from, to, accountId) as { category: string; total: number }[];

  return { income: row.income, expenses: row.expenses, net: row.income - row.expenses, byCategory };
}

function getFilteredFlexSummary(from: string, to: string, accountId: string): FlexSummary {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN c.flexibility = 'fixed'         AND t.amount > 0 THEN t.amount ELSE 0 END), 0) as fixed,
      COALESCE(SUM(CASE WHEN c.flexibility = 'flexible'      AND t.amount > 0 THEN t.amount ELSE 0 END), 0) as flexible,
      COALESCE(SUM(CASE WHEN c.flexibility = 'discretionary' AND t.amount > 0 THEN t.amount ELSE 0 END), 0) as discretionary,
      COALESCE(SUM(CASE WHEN c.flexibility IS NULL           AND t.amount > 0 THEN t.amount ELSE 0 END), 0) as untagged
    FROM transactions t
    LEFT JOIN categories c ON c.name = t.category
    WHERE t.date >= ? AND t.date <= ? AND t.account_id = ?
      AND t.pending = 0 AND t.ignored = 0
      AND t.category NOT IN (SELECT category FROM hidden_categories)
  `).get(from, to, accountId) as FlexSummary;
}

type AccountRow = { id: string; name: string; subtype: string | null; balance: number | null };

function getAccountRows(): AccountRow[] {
  return db.prepare(`
    SELECT a.id, a.name, a.subtype,
      (SELECT balance FROM balance_history WHERE account_id = a.id ORDER BY date DESC LIMIT 1) as balance
    FROM accounts a
    ORDER BY CASE a.type WHEN 'depository' THEN 0 WHEN 'investment' THEN 1 ELSE 2 END, a.name
  `).all() as AccountRow[];
}

const FLEX_TIERS: Array<{ key: keyof FlexSummary; label: string; color: string }> = [
  { key: 'fixed',         label: 'Fixed',        color: 'red'    },
  { key: 'flexible',      label: 'Flexible',      color: 'yellow' },
  { key: 'discretionary', label: 'Discretionary', color: 'cyan'   },
  { key: 'untagged',      label: 'Untagged',      color: 'white'  },
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

  // Account filter
  const [accountRows] = useState<AccountRow[]>(getAccountRows);
  const [acctCursor, setAcctCursor] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<AccountRow | null>(null);

  function load(r: Range, a: Date, acct: AccountRow | null) {
    const { from, to } = getPeriodDates(r, a);
    if (acct) {
      setSummary(getFilteredRangeSummary(from, to, acct.id));
      setFlexData(getFilteredFlexSummary(from, to, acct.id));
      setUncategorized(getUncategorizedCount(from, to, acct.id));
    } else {
      setSummary(getRangeSummary(from, to));
      setFlexData(getFlexSummary(from, to));
      setUncategorized(getUncategorizedCount(from, to));
    }
  }

  useEffect(() => {
    load(range, anchor, selectedAccount);
    setCatCursor(0);
  }, [range, anchor.toISOString().slice(0, 10), selectedAccount?.id ?? null]);

  const categories = summary?.byCategory ?? [];

  useInput((input, key) => {
    if (key.tab) {
      setView((v) => v === 'categories' ? 'flex' : v === 'flex' ? 'account' : 'categories');
      return;
    }

    // Period navigation (not in account picker)
    if (view !== 'account') {
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
    }

    if (view === 'categories') {
      if (key.upArrow)   { setCatCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCatCursor((c) => Math.min(categories.length - 1, c + 1)); return; }
      if (key.return) {
        const cat = categories[catCursor];
        if (cat) {
          const { from, to } = getPeriodDates(range, anchor);
          onNavigate('transactions', { category: cat.category, from, to, ...(selectedAccount ? { account: selectedAccount.id } : {}) });
        }
        return;
      }
    }

    if (view === 'flex') {
      if (key.return) {
        const { from, to } = getPeriodDates(range, anchor);
        onNavigate('transactions', { from, to, ...(selectedAccount ? { account: selectedAccount.id } : {}) });
        return;
      }
    }

    if (view === 'account') {
      if (key.upArrow   || key.leftArrow)  { setAcctCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow || key.rightArrow) { setAcctCursor((c) => Math.min(accountRows.length - 1, c + 1)); return; }
      if (key.return) {
        const acct = accountRows[acctCursor];
        if (acct) {
          setSelectedAccount(selectedAccount?.id === acct.id ? null : acct);
          setView('categories');
        }
        return;
      }
      if (input === 'c') { setSelectedAccount(null); return; }
    }

    if (input === 'r') {
      const idx = RANGES.indexOf(range);
      const next = RANGES[(idx + 1) % RANGES.length];
      setRange(next);
      setAnchor(getPeriodStart(next, now));
      setCatCursor(0);
      return;
    }

    if (input === '2') onNavigate('transactions');
    if (input === '3') onNavigate('trends');
    if (input === '4') onNavigate('networth');
    if (input === '5') onNavigate('tags');
    if (input === '6') onNavigate('health');
    if (input === '7') onNavigate('rules');
    if (input === '8') onNavigate('accounts');
  });

  const maxCategorySpend = categories[0]?.total ?? 1;
  const totalExpenses = summary?.expenses ?? 0;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[2] txns  [3] trends  [4] worth  [5] tags  [6] health  [7] rules  [8] accounts</Text>
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
          {selectedAccount && <Text color="yellow">{selectedAccount.name}</Text>}
          <Box gap={1}>
            <Text color={view === 'categories' ? 'cyan' : undefined} dimColor={view !== 'categories'}>categories</Text>
            <Text dimColor>/</Text>
            <Text color={view === 'flex' ? 'cyan' : undefined} dimColor={view !== 'flex'}>flex</Text>
            <Text dimColor>/</Text>
            <Text color={view === 'account' ? 'cyan' : undefined} dimColor={view !== 'account'}>account</Text>
            <Text dimColor>[Tab]</Text>
          </Box>
        </Box>
        <Text dimColor>
          {view === 'account'
            ? `↑↓ select  ·  Enter ${selectedAccount ? 'switch' : 'filter'}  ·  [c] clear`
            : view === 'categories'
            ? '← → period  ·  ↑↓ select  ·  Enter txns'
            : '← → period  ·  Enter txns'}
        </Text>
      </Box>

      <Divider />

      {view === 'account' ? (
        <Box flexDirection="column" marginTop={1}>
          {accountRows.length === 0 ? (
            <Text dimColor>No accounts linked. [8] accounts → link a bank.</Text>
          ) : (
            accountRows.map((acct, i) => {
              const isSelected = i === acctCursor;
              const isFiltered = selectedAccount?.id === acct.id;
              return (
                <Box key={acct.id} gap={2}>
                  <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '▶' : ' '}</Text>
                  <Text color={isFiltered ? 'yellow' : isSelected ? 'cyan' : undefined} dimColor={!isSelected && !isFiltered}>
                    {acct.name.padEnd(28)}
                  </Text>
                  <Text dimColor>{(acct.subtype ?? '').padEnd(12)}</Text>
                  {acct.balance !== null
                    ? <Text dimColor>{fmtInt(acct.balance).padStart(12)}</Text>
                    : <Text dimColor>{'—'.padStart(12)}</Text>}
                  {isFiltered && <Text color="yellow">  ● filtered</Text>}
                </Box>
              );
            })
          )}
          {selectedAccount && (
            <Box marginTop={1}><Text dimColor>[c] clear filter</Text></Box>
          )}
        </Box>
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
                <Box marginTop={1}><Text dimColor>{pct(flexData.untagged, totalExpenses)} untagged — set tiers in Rules → Categories</Text></Box>
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
