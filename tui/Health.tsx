import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import type { Screen } from './App.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_WITHDRAWAL = 4.0;
const DEFAULT_GROWTH = 7.0;
const SPEND_STEP = 100;
const WITHDRAW_STEP = 0.5;
const GROWTH_STEP = 1.0;
const PROGRESS_BAR_WIDTH = 22;

const DIALS = ['spend', 'savings', 'withdrawal', 'growth'] as const;
type Dial = typeof DIALS[number];

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthData = {
  avgMonthlyExpenses: number;   // raw avg, not rounded
  monthlySavings: number;       // avg monthly (income - expenses) past 12mo
  cash: number;                 // depository accounts
  liquid: number;               // depository + brokerage
  netWorth: number;             // all assets - liabilities
};

// ─── Data loading ─────────────────────────────────────────────────────────────

function loadHealthData(): HealthData {
  const expRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) / 12.0  AS avg_expenses,
      COALESCE(
        -SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) -
         SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),
        0
      ) / 12.0 AS avg_savings
    FROM transactions
    WHERE date >= date('now', '-12 months')
      AND pending = 0 AND ignored = 0
      AND category NOT IN (SELECT category FROM hidden_categories)
      AND category != 'Transfer'
  `).get() as { avg_expenses: number; avg_savings: number };

  const cashRow = db.prepare(`
    SELECT COALESCE(SUM(bh.balance), 0) AS cash
    FROM accounts a
    JOIN balance_history bh ON bh.account_id = a.id
    WHERE a.type = 'depository'
      AND bh.date = (SELECT MAX(date) FROM balance_history WHERE account_id = a.id)
  `).get() as { cash: number };

  // Liquid = cash + brokerage (not retirement accounts)
  const liquidRow = db.prepare(`
    SELECT COALESCE(SUM(bh.balance), 0) AS liquid
    FROM accounts a
    JOIN balance_history bh ON bh.account_id = a.id
    WHERE (
      a.type = 'depository'
      OR (a.type = 'investment' AND LOWER(COALESCE(a.subtype, ''))
          IN ('brokerage', 'cash isa', 'non-taxable brokerage account'))
    )
    AND bh.date = (SELECT MAX(date) FROM balance_history WHERE account_id = a.id)
  `).get() as { liquid: number };

  const nwRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.type IN ('depository','investment') THEN bh.balance ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN a.type = 'credit' THEN bh.balance ELSE 0 END), 0) AS net_worth
    FROM accounts a
    JOIN balance_history bh ON bh.account_id = a.id
    WHERE bh.date = (SELECT MAX(date) FROM balance_history WHERE account_id = a.id)
  `).get() as { net_worth: number };

  return {
    avgMonthlyExpenses: expRow.avg_expenses,
    monthlySavings: expRow.avg_savings,
    cash: cashRow.cash,
    liquid: liquidRow.liquid,
    netWorth: nwRow.net_worth,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function fmtMonths(n: number) {
  if (!isFinite(n) || n > 999) return '∞';
  return `${n.toFixed(1)} mo`;
}

function progressBar(ratio: number, width = PROGRESS_BAR_WIDTH) {
  const filled = Math.min(width, Math.max(0, Math.round(Math.min(1, ratio) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Iterate month by month to find years until wealth >= target. */
function yearsToFire(
  netWorth: number,
  monthlySavings: number,
  target: number,
  annualGrowthPct: number,
): number | null {
  if (target <= 0) return 0;
  if (netWorth >= target) return 0;
  const r = Math.pow(1 + annualGrowthPct / 100, 1 / 12) - 1;
  let wealth = netWorth;
  for (let month = 1; month <= 1200; month++) {
    wealth = wealth * (1 + r) + monthlySavings;
    if (wealth >= target) return month / 12;
  }
  return null; // > 100 years
}

function runwayColor(months: number, green: number, yellow: number) {
  if (months >= green) return 'green';
  if (months >= yellow) return 'yellow';
  return 'red';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Health({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const [data] = useState<HealthData>(loadHealthData);

  // Round raw avg to nearest $500 as the default dial value
  const defaultSpend   = Math.max(SPEND_STEP, Math.round(data.avgMonthlyExpenses / SPEND_STEP) * SPEND_STEP);
  const defaultSavings = Math.round(data.monthlySavings / SPEND_STEP) * SPEND_STEP;

  const [dialIdx, setDialIdx] = useState(0);
  const [monthlySpend, setMonthlySpend] = useState(defaultSpend);
  const [monthlySavings, setMonthlySavings] = useState(defaultSavings);
  const [withdrawal, setWithdrawal] = useState(DEFAULT_WITHDRAWAL);
  const [growth, setGrowth] = useState(DEFAULT_GROWTH);

  const currentDial: Dial = DIALS[dialIdx];

  useInput((input, key) => {
    if (key.escape || input === '6') { onNavigate('health'); return; }
    if (input === '1') { onNavigate('dashboard'); return; }
    if (input === '2') { onNavigate('transactions'); return; }
    if (input === '3') { onNavigate('trends'); return; }
    if (input === '4') { onNavigate('networth'); return; }
    if (input === '5') { onNavigate('tags'); return; }
    if (input === '7') { onNavigate('rules'); return; }
    if (input === '8') { onNavigate('accounts'); return; }

    if (key.upArrow)   { setDialIdx((i) => (i - 1 + DIALS.length) % DIALS.length); return; }
    if (key.downArrow) { setDialIdx((i) => (i + 1) % DIALS.length); return; }

    if (key.rightArrow) {
      if (currentDial === 'spend')      setMonthlySpend((s) => s + SPEND_STEP);
      if (currentDial === 'savings')    setMonthlySavings((s) => s + SPEND_STEP);
      if (currentDial === 'withdrawal') setWithdrawal((w) => parseFloat(Math.min(10, w + WITHDRAW_STEP).toFixed(1)));
      if (currentDial === 'growth')     setGrowth((g) => parseFloat(Math.min(20, g + GROWTH_STEP).toFixed(1)));
      return;
    }
    if (key.leftArrow) {
      if (currentDial === 'spend')      setMonthlySpend((s) => Math.max(SPEND_STEP, s - SPEND_STEP));
      if (currentDial === 'savings')    setMonthlySavings((s) => s - SPEND_STEP);
      if (currentDial === 'withdrawal') setWithdrawal((w) => parseFloat(Math.max(0.5, w - WITHDRAW_STEP).toFixed(1)));
      if (currentDial === 'growth')     setGrowth((g) => parseFloat(Math.max(0, g - GROWTH_STEP).toFixed(1)));
      return;
    }
    if (input === 'r') {
      if (currentDial === 'spend')      setMonthlySpend(defaultSpend);
      if (currentDial === 'savings')    setMonthlySavings(defaultSavings);
      if (currentDial === 'withdrawal') setWithdrawal(DEFAULT_WITHDRAWAL);
      if (currentDial === 'growth')     setGrowth(DEFAULT_GROWTH);
      return;
    }
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const cashMonths   = monthlySpend > 0 ? data.cash   / monthlySpend : 0;
  const liquidMonths = monthlySpend > 0 ? data.liquid / monthlySpend : 0;

  const annualSpend  = monthlySpend * 12;
  const fireNumber   = annualSpend / (withdrawal / 100);
  const fireProgress = fireNumber > 0 ? Math.max(0, data.netWorth) / fireNumber : 0;
  const years        = yearsToFire(data.netWorth, monthlySavings, fireNumber, growth);

  const spendChanged    = monthlySpend !== defaultSpend;
  const savingsChanged  = monthlySavings !== defaultSavings;
  const withdrawChanged = withdrawal !== DEFAULT_WITHDRAWAL;
  const growthChanged   = growth !== DEFAULT_GROWTH;

  const L = 18; // label column width

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Nav */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [2] txns  [3] trends  [4] worth  [5] tags  [7] rules  [8] accounts</Text>
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Text bold color="cyan">Financial Health</Text>
        <Text dimColor>↑↓ select  ·  ← → adjust  ·  [r] reset</Text>
      </Box>
      <Text dimColor>{'─'.repeat(70)}</Text>

      {/* ── Runway ─────────────────────────────────────────────────────────── */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>RUNWAY</Text>
        <Box gap={3} marginTop={1}>
          <Text dimColor>{'Cash'.padEnd(L)}</Text>
          <Text bold color={runwayColor(cashMonths, 6, 3)}>
            {fmtMonths(cashMonths).padStart(8)}
          </Text>
          <Text dimColor>{fmt(data.cash)} in checking/savings</Text>
        </Box>
        <Box gap={3}>
          <Text dimColor>{'Liquid'.padEnd(L)}</Text>
          <Text bold color={runwayColor(liquidMonths, 12, 6)}>
            {fmtMonths(liquidMonths).padStart(8)}
          </Text>
          <Text dimColor>{fmt(data.liquid)} incl. brokerage</Text>
        </Box>
      </Box>

      {/* ── Retirement ─────────────────────────────────────────────────────── */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold dimColor>RETIREMENT</Text>
        <Box gap={3} marginTop={1}>
          <Text dimColor>{'Net worth'.padEnd(L)}</Text>
          <Text bold color={data.netWorth >= 0 ? 'green' : 'red'}>
            {fmt(data.netWorth).padStart(12)}
          </Text>
        </Box>
        <Box gap={3}>
          <Text dimColor>{'FIRE number'.padEnd(L)}</Text>
          <Text bold>{fmt(fireNumber).padStart(12)}</Text>
          <Text dimColor>  {fmtPct(fireProgress * 100)}</Text>
          <Text color="cyan" dimColor>{progressBar(fireProgress)}</Text>
        </Box>
        <Box gap={3}>
          <Text dimColor>{'Est. years away'.padEnd(L)}</Text>
          {years === null ? (
            <Text color="yellow">{'100+ years'.padStart(12)}</Text>
          ) : years === 0 ? (
            <Text color="green" bold>{'Achieved!'.padStart(12)}</Text>
          ) : (
            <Text bold color="cyan">{`~${Math.ceil(years)} yr`.padStart(12)}</Text>
          )}
        </Box>
      </Box>

      {/* ── Assumptions ────────────────────────────────────────────────────── */}
      <Box marginTop={1}><Text dimColor>{'─'.repeat(70)}</Text></Box>
      <Text bold dimColor>ASSUMPTIONS</Text>

      <Box flexDirection="column" marginTop={1}>
        {/* Monthly spending */}
        <Box gap={2}>
          <Text color={currentDial === 'spend' ? 'cyan' : undefined}>
            {currentDial === 'spend' ? '▶' : ' '} {'Monthly spending'.padEnd(16)}
          </Text>
          <Text color={currentDial === 'spend' ? 'cyan' : 'white'}>
            {'[ '}{fmt(monthlySpend).padStart(8)}{' ]'}
          </Text>
          <Text dimColor>
            {currentDial === 'spend'
              ? (spendChanged ? `default ${fmt(defaultSpend)} · [r] reset` : `avg past 12 months  ← → ±${fmt(SPEND_STEP)}`)
              : `avg past 12 months${spendChanged ? ' (modified)' : ''}`}
          </Text>
        </Box>

        {/* Monthly savings */}
        <Box gap={2}>
          <Text color={currentDial === 'savings' ? 'cyan' : undefined}>
            {currentDial === 'savings' ? '▶' : ' '} {'Monthly savings'.padEnd(16)}
          </Text>
          <Text color={currentDial === 'savings' ? 'cyan' : 'white'}>
            {'[ '}{fmt(monthlySavings).padStart(8)}{' ]'}
          </Text>
          <Text dimColor>
            {currentDial === 'savings'
              ? (savingsChanged ? `default ${fmt(defaultSavings)} · [r] reset` : `avg surplus past 12 mo  ← → ±${fmt(SPEND_STEP)}`)
              : `avg surplus past 12 mo${savingsChanged ? ' (modified)' : ''}`}
          </Text>
        </Box>

        {/* Withdrawal rate */}
        <Box gap={2}>
          <Text color={currentDial === 'withdrawal' ? 'cyan' : undefined}>
            {currentDial === 'withdrawal' ? '▶' : ' '} {'Withdrawal rate'.padEnd(16)}
          </Text>
          <Text color={currentDial === 'withdrawal' ? 'cyan' : 'white'}>
            {'[ '}{fmtPct(withdrawal).padStart(8)}{' ]'}
          </Text>
          <Text dimColor>
            {currentDial === 'withdrawal'
              ? `↑↓ ±${fmtPct(WITHDRAW_STEP)}${withdrawChanged ? ' · [r] reset' : ''}`
              : `safe withdrawal rate${withdrawChanged ? ' (modified)' : ''}`}
          </Text>
        </Box>

        {/* Growth rate */}
        <Box gap={2}>
          <Text color={currentDial === 'growth' ? 'cyan' : undefined}>
            {currentDial === 'growth' ? '▶' : ' '} {'Growth rate'.padEnd(16)}
          </Text>
          <Text color={currentDial === 'growth' ? 'cyan' : 'white'}>
            {'[ '}{fmtPct(growth).padStart(8)}{' ]'}
          </Text>
          <Text dimColor>
            {currentDial === 'growth'
              ? `↑↓ ±${fmtPct(GROWTH_STEP)}${growthChanged ? ' · [r] reset' : ''}`
              : `real annual return${growthChanged ? ' (modified)' : ''}`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
