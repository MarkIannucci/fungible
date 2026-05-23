import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import { categorize } from '../core/categorize.js';
import type { Screen, TxFilter } from './App.js';

const CATEGORIES = [
  'Income', 'Transfer', 'Food & Drink', 'Shopping', 'Transportation',
  'Travel', 'Bills & Utilities', 'Insurance', 'Medical', 'Personal Care',
  'Childcare', 'Entertainment', 'Home', 'Services', 'Fees',
  'Government', 'Taxes', 'Loan Payment', 'Uncategorized',
];

type Tx = {
  id: string;
  date: string;
  name: string;
  display_name: string | null;
  merchant_name: string | null;
  amount: number;
  category: string;
  manual_category: string | null;
  ignored: number;
};

type Mode = 'list' | 'search' | 'categorize' | 'override';

function getTxs(category: string | null, month: number | null, year: number | null, search: string): Tx[] {
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (category) { conditions.push('t.category = ?'); args.push(category); }
  if (month && year) {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to   = `${year}-${String(month).padStart(2, '0')}-31`;
    conditions.push('t.date >= ? AND t.date <= ?');
    args.push(from, to);
  }
  if (search) {
    conditions.push('(t.name LIKE ? OR t.display_name LIKE ? OR t.merchant_name LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return db.prepare(`
    SELECT t.id, t.date, t.name, t.display_name, t.merchant_name, t.amount, t.category, t.manual_category, t.ignored
    FROM transactions t
    ${where}
    ORDER BY t.date DESC
    LIMIT 200
  `).all(...args) as Tx[];
}

function fmt(amount: number) {
  const s = `$${Math.abs(amount).toFixed(2)}`;
  return amount < 0 ? `+${s}` : `-${s}`;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function applyRuleToAll() {
  const rows = db.prepare(
    'SELECT id, name, merchant_name, raw_category FROM transactions WHERE manual_category IS NULL'
  ).all() as { id: string; name: string; merchant_name: string | null; raw_category: string | null }[];
  const update = db.prepare('UPDATE transactions SET category = ? WHERE id = ?');
  let count = 0;
  for (const tx of rows) {
    const cat = categorize(tx.name, tx.merchant_name, tx.raw_category);
    if (cat !== 'Uncategorized') { update.run(cat, tx.id); count++; }
  }
  return count;
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

export function Transactions({ onNavigate, initialFilter }: { onNavigate: (s: Screen, f?: TxFilter) => void; initialFilter?: TxFilter }) {
  const [category, setCategory] = useState<string | null>(initialFilter?.category ?? null);
  const [month, setMonth] = useState<number | null>(initialFilter?.month ?? null);
  const [year, setYear] = useState<number | null>(initialFilter?.year ?? null);
  const [bounds] = useState(getDataBounds);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [catCursor, setCatCursor] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  function load(s = search, keepCursor = false) {
    const rows = getTxs(category, month, year, s);
    setTxs(rows);
    if (!keepCursor) setCursor(0);
    else setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }

  useEffect(() => { load(); }, [category, month, year, search]);

  const selected = txs[cursor];

  function applyRule(cat: string) {
    if (!selected) return;
    db.prepare(`INSERT INTO category_rules (priority, match_type, pattern, category) VALUES (10, 'name', ?, ?)`)
      .run(selected.name, cat);
    const count = applyRuleToAll();
    setStatusMsg(`Rule saved · recategorized ${count} transactions`);
    setMode('list');
    setTimeout(() => setStatusMsg(''), 3000);
    load(search, true);
  }

  function applyOverride(cat: string) {
    if (!selected) return;
    db.prepare('UPDATE transactions SET category = ?, manual_category = ? WHERE id = ?')
      .run(cat, cat, selected.id);
    setStatusMsg('Category set');
    setMode('list');
    setTimeout(() => setStatusMsg(''), 3000);
    load(search, true);
  }

  function toggleIgnored() {
    if (!selected) return;
    db.prepare('UPDATE transactions SET ignored = CASE WHEN ignored = 1 THEN 0 ELSE 1 END WHERE id = ?')
      .run(selected.id);
    load(search, true);
  }

  function clearOverride() {
    if (!selected || !selected.manual_category) return;
    const raw = (db.prepare('SELECT raw_category FROM transactions WHERE id = ?')
      .get(selected.id) as { raw_category: string | null })?.raw_category ?? null;
    db.prepare('UPDATE transactions SET category = ?, manual_category = NULL WHERE id = ?')
      .run(categorize(selected.name, selected.merchant_name, raw), selected.id);
    setStatusMsg('Override cleared');
    setTimeout(() => setStatusMsg(''), 2000);
    load(search, true);
  }

  useInput((input, key) => {
    if (mode === 'search') {
      if (key.escape) {
        setSearchInput('');
        setSearch('');
        setMode('list');
        return;
      }
      if (key.return) {
        setSearch(searchInput);
        setMode('list');
        return;
      }
      if (key.backspace || key.delete) {
        const next = searchInput.slice(0, -1);
        setSearchInput(next);
        setSearch(next);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        const next = searchInput + input;
        setSearchInput(next);
        setSearch(next);
      }
      return;
    }

    if (mode === 'list') {
      if (input === '1') { onNavigate('dashboard'); return; }
      if (input === '3') { onNavigate('rules'); return; }
      if (input === '4') { onNavigate('import'); return; }
      if (key.escape) {
        if (search) { setSearch(''); setSearchInput(''); return; }
        if (month) { setMonth(null); setYear(null); return; }
        onNavigate('dashboard');
        return;
      }
      if (key.leftArrow) {
        const m = month ?? bounds.maxMonth;
        const y = year ?? bounds.maxYear;
        const prevM = m === 1 ? 12 : m - 1;
        const prevY = m === 1 ? y - 1 : y;
        if (prevY > bounds.minYear || (prevY === bounds.minYear && prevM >= bounds.minMonth)) {
          setMonth(prevM); setYear(prevY);
        }
        return;
      }
      if (key.rightArrow) {
        const m = month ?? bounds.maxMonth;
        const y = year ?? bounds.maxYear;
        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        if (nextY < bounds.maxYear || (nextY === bounds.maxYear && nextM <= bounds.maxMonth)) {
          setMonth(nextM); setYear(nextY);
        }
        return;
      }
      if (input === '/') { setMode('search'); return; }
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(txs.length - 1, c + 1));
      if (input === 'u') { setSearch(''); setSearchInput(''); setCategory('Uncategorized'); setMonth(null); setYear(null); }
      if (input === 'a') { setSearch(''); setSearchInput(''); setCategory(null); setMonth(null); setYear(null); }
      if (input === 'c' && selected) { setCatCursor(0); setMode('categorize'); }
      if (input === 'e' && selected) { setCatCursor(Math.max(0, CATEGORIES.indexOf(selected.category))); setMode('override'); }
      if (input === 'x' && selected?.manual_category) clearOverride();
      if (input === 'i' && selected) toggleIgnored();
    } else if (mode === 'categorize') {
      if (key.upArrow) setCatCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCatCursor((c) => Math.min(CATEGORIES.length - 1, c + 1));
      if (key.return) applyRule(CATEGORIES[catCursor]);
      if (key.escape) setMode('list');
    } else if (mode === 'override') {
      if (key.upArrow) setCatCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCatCursor((c) => Math.min(CATEGORIES.length - 1, c + 1));
      if (key.return) applyOverride(CATEGORIES[catCursor]);
      if (key.escape) setMode('list');
    }
  });

  const PAGE = 20;
  const pageStart = Math.max(0, Math.min(cursor - Math.floor(PAGE / 2), txs.length - PAGE));
  const visible = txs.slice(pageStart, pageStart + PAGE);

  const filterLabel = [
    search ? `"${search}"` : null,
    category,
    month && year ? `${MONTHS[month - 1]} ${year}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [3] rules  [4] import</Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Text bold>
          Transactions
          {filterLabel ? <Text color="yellow">  {filterLabel}</Text> : null}
        </Text>
        <Text dimColor>
          {month ? '← → month  ·  ' : ''}[/] search  ·  [u] uncategorized  [a] all  ·  [c] rule  [e] edit  [x] undo edit  [i] ignore
        </Text>
      </Box>

      {mode === 'search' ? (
        <Box marginTop={1}>
          <Text color="cyan">/</Text>
          <Text>{searchInput}</Text>
          <Text color="cyan">█</Text>
          <Text dimColor>  Esc cancel</Text>
        </Box>
      ) : null}
      <Text dimColor marginTop={1}>{'─'.repeat(80)}</Text>

      <Box gap={2} marginTop={1}>
        <Text dimColor>{'  DATE      '}</Text>
        <Text dimColor>{'DESCRIPTION'.padEnd(36)}</Text>
        <Text dimColor>{'AMOUNT'.padStart(10)}</Text>
        <Text dimColor>{'CATEGORY'}</Text>
      </Box>

      {visible.map((tx) => {
        const isSelected = tx.id === selected?.id;
        const isPinned = !!tx.manual_category;
        const isIgnored = !!tx.ignored;
        return (
          <Box key={tx.id} gap={2}>
            <Text color={isSelected ? 'cyan' : undefined} dimColor={isIgnored && !isSelected}>
              {isSelected ? '▶ ' : '  '}{tx.date}
            </Text>
            <Text dimColor={isIgnored}>{truncate(tx.display_name ?? tx.name, 36)}</Text>
            <Text color={isIgnored ? undefined : tx.amount < 0 ? 'green' : undefined} dimColor={isIgnored}>
              {fmt(tx.amount).padStart(10)}
            </Text>
            <Text
              color={isIgnored ? undefined : tx.category === 'Uncategorized' ? 'yellow' : isPinned ? 'magenta' : undefined}
              dimColor={isIgnored || !isSelected}
            >
              {isPinned ? '◆ ' : '  '}{isIgnored ? '~' : ''}{tx.category}
            </Text>
          </Box>
        );
      })}

      <Text dimColor>{'─'.repeat(80)}</Text>
      <Text dimColor>{txs.length} transactions{txs.length === 200 ? ' (limit 200)' : ''}</Text>
      {statusMsg && <Text color="green">{statusMsg}</Text>}

      {mode === 'categorize' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
          <Text bold>Rule: <Text color="yellow">{selected?.name}</Text></Text>
          <Text dimColor>Creates a rule · applies to all matching transactions · ↑↓ · Enter · Esc</Text>
          <Box flexDirection="column" marginTop={1}>
            {CATEGORIES.map((cat, i) => (
              <Text key={cat} color={i === catCursor ? 'cyan' : undefined} dimColor={i !== catCursor}>
                {i === catCursor ? '▶ ' : '  '}{cat}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {mode === 'override' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
          <Text bold>Edit: <Text color="yellow">{selected?.name}</Text></Text>
          <Text dimColor>Pins this transaction only · survives syncs · shown in <Text color="magenta">magenta ◆</Text> · ↑↓ · Enter · Esc</Text>
          <Box flexDirection="column" marginTop={1}>
            {CATEGORIES.map((cat, i) => (
              <Text key={cat} color={i === catCursor ? 'magenta' : undefined} dimColor={i !== catCursor}>
                {i === catCursor ? '▶ ' : '  '}{cat}
              </Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
