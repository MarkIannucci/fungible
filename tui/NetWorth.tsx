import React from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import type { Screen } from './App.js';

const BAR_WIDTH = 32;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type AccountBalance = {
  name: string;
  type: string;
  subtype: string | null;
  balance: number;
};

type TypeBalance = { label: string; balance: number };

type ViewMode = 'accounts' | 'types';

type HistoryRow = {
  date: string;
  assets: number;
  liabilities: number;
  net: number;
};

function fmt(n: number) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSigned(n: number) {
  return `${n >= 0 ? '+' : '-'}${fmt(n)}`;
}
function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function bar(val: number, max: number) {
  const filled = max > 0 ? Math.min(BAR_WIDTH, Math.max(0, Math.round((val / max) * BAR_WIDTH))) : 0;
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}
function dateLabel(d: string) {
  const dt = new Date(d + 'T12:00:00');
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()} ${dt.getFullYear()}`;
}

function loadData(): { accounts: AccountBalance[]; history: HistoryRow[] } {
  const accounts = db.prepare(`
    SELECT a.name, a.type, a.subtype, bh.balance
    FROM accounts a
    JOIN balance_history bh ON bh.account_id = a.id
    WHERE bh.date = (SELECT MAX(date) FROM balance_history WHERE account_id = a.id)
    ORDER BY
      CASE a.type WHEN 'depository' THEN 0 WHEN 'investment' THEN 1 ELSE 2 END,
      bh.balance DESC
  `).all() as AccountBalance[];

  const history = (db.prepare(`
    SELECT bh.date,
      SUM(CASE WHEN a.type IN ('depository','investment') OR (a.type = 'other' AND bh.balance > 0) THEN bh.balance ELSE 0 END) as assets,
      SUM(CASE WHEN a.type = 'credit' THEN bh.balance ELSE 0 END) as liabilities
    FROM balance_history bh
    JOIN accounts a ON a.id = bh.account_id
    GROUP BY bh.date
    ORDER BY bh.date
  `).all() as { date: string; assets: number; liabilities: number }[]).map((r) => ({
    ...r,
    net: r.assets - r.liabilities,
  }));

  return { accounts, history };
}

function groupByType(accs: AccountBalance[]): TypeBalance[] {
  const map = new Map<string, number>();
  for (const a of accs) {
    const key = a.subtype ?? a.type;
    map.set(key, (map.get(key) ?? 0) + a.balance);
  }
  return [...map.entries()]
    .map(([label, balance]) => ({ label, balance }))
    .sort((a, b) => b.balance - a.balance);
}

export function NetWorth({ onNavigate, isActive }: { onNavigate: (s: Screen) => void; isActive?: boolean }) {
  const { accounts, history } = loadData();
  const [view, setView] = React.useState<ViewMode>('accounts');

  useInput((input, key) => {
    if (key.tab) { setView((v) => v === 'accounts' ? 'types' : 'accounts'); return; }
    if (key.escape || input === '4') { onNavigate('networth'); return; }
    if (input === '1') { onNavigate('dashboard'); return; }
    if (input === '2') { onNavigate('transactions'); return; }
    if (input === '3') { onNavigate('trends'); return; }
    if (input === '5') { onNavigate('tags'); return; }
    if (input === '6') { onNavigate('health'); return; }
    if (input === '7') { onNavigate('rules'); return; }
    if (input === '8') { onNavigate('accounts'); return; }
  }, { isActive: isActive !== false });

  const assets      = accounts.filter((a) => a.type === 'depository' || a.type === 'investment' || (a.type === 'other' && a.balance > 0));
  const liabilities = accounts.filter((a) => a.type === 'credit');

  const totalAssets      = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
  const netWorth         = totalAssets - totalLiabilities;

  const current = history[history.length - 1];
  const maxNet  = Math.max(...history.map((r) => Math.abs(r.net)), 1);
  const hasHistory = history.length > 1;

  const assetTypes      = groupByType(assets);
  const liabilityTypes  = groupByType(liabilities);

  const NAME_W = 28;
  const AMT_W  = 14;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [2] txns  [3] trends  [5] tags  [6] health  [7] rules  [8] accounts</Text>
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <Text bold color="cyan">Net Worth</Text>
          {current && <Text dimColor>  as of {dateLabel(current.date)}</Text>}
        </Box>
        <Text dimColor>[Tab] {view === 'accounts' ? 'by type' : 'by account'}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(70)}</Text>

      {accounts.length === 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>No balance data yet.</Text>
          <Text dimColor>Sync your accounts ([8] accounts → [s]) to populate.</Text>
        </Box>
      ) : (
        <>
          {/* Big net worth number */}
          <Box marginTop={1} marginBottom={1}>
            <Text bold color={netWorth >= 0 ? 'green' : 'red'}>
              {fmtSigned(netWorth).padStart(18)}
            </Text>
          </Box>

          {/* Assets */}
          <Box flexDirection="column">
            <Text bold color="green">Assets</Text>
            {view === 'accounts' ? assets.map((a) => (
              <Box key={a.name + a.balance} gap={2}>
                <Text dimColor>{truncate(a.name, NAME_W).padEnd(NAME_W)}</Text>
                <Text>{fmt(a.balance).padStart(AMT_W)}</Text>
                <Text dimColor>{a.subtype ?? a.type}</Text>
              </Box>
            )) : assetTypes.map((t) => (
              <Box key={t.label} gap={2}>
                <Text dimColor>{t.label.padEnd(NAME_W)}</Text>
                <Text>{fmt(t.balance).padStart(AMT_W)}</Text>
              </Box>
            ))}
            <Box gap={2} marginTop={0}>
              <Text dimColor>{'─'.repeat(NAME_W)}</Text>
            </Box>
            <Box gap={2}>
              <Text bold>{'Total assets'.padEnd(NAME_W)}</Text>
              <Text bold color="green">{fmt(totalAssets).padStart(AMT_W)}</Text>
            </Box>
          </Box>

          {/* Liabilities */}
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="red">Liabilities</Text>
            {view === 'accounts' ? liabilities.map((a) => (
              <Box key={a.name + a.balance} gap={2}>
                <Text dimColor>{truncate(a.name, NAME_W).padEnd(NAME_W)}</Text>
                <Text>{fmt(a.balance).padStart(AMT_W)}</Text>
              </Box>
            )) : liabilityTypes.map((t) => (
              <Box key={t.label} gap={2}>
                <Text dimColor>{t.label.padEnd(NAME_W)}</Text>
                <Text>{fmt(t.balance).padStart(AMT_W)}</Text>
              </Box>
            ))}
            <Box gap={2}>
              <Text dimColor>{'─'.repeat(NAME_W)}</Text>
            </Box>
            <Box gap={2}>
              <Text bold>{'Total debt'.padEnd(NAME_W)}</Text>
              <Text bold color="red">{fmt(totalLiabilities).padStart(AMT_W)}</Text>
            </Box>
          </Box>

          {/* History */}
          {hasHistory && (
            <>
              <Box marginTop={1}><Text dimColor>{'─'.repeat(70)}</Text></Box>
              <Text bold>History</Text>
              <Box flexDirection="column">
                {history.map((row) => (
                  <Box key={row.date} gap={2}>
                    <Text dimColor>{dateLabel(row.date).padEnd(16)}</Text>
                    <Text color={row.net >= 0 ? 'green' : 'red'}>
                      {fmtSigned(row.net).padStart(14)}
                    </Text>
                    <Text color={row.net >= 0 ? 'green' : 'red'} dimColor>
                      {bar(Math.abs(row.net), maxNet)}
                    </Text>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}
