import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import { categorize } from '../core/categorize.js';
import { rebuildDisplayNames } from '../core/rename.js';
import type { Screen, TxFilter } from './App.js';

function getCategories(): string[] {
  return (db.prepare('SELECT name FROM categories ORDER BY name').all() as { name: string }[]).map((r) => r.name);
}

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

type Mode = 'list' | 'search' | 'edit' | 'edit-rule';
type EditField = 'name' | 'category';

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

function countMatches(pattern: string, matchType: 'name' | 'regex'): number {
  if (!pattern) return 0;
  try {
    if (matchType === 'name') {
      return (db.prepare(
        "SELECT COUNT(*) as c FROM transactions WHERE name LIKE ? OR COALESCE(merchant_name, '') LIKE ?"
      ).get(`%${pattern}%`, `%${pattern}%`) as { c: number }).c;
    }
    const re = new RegExp(pattern, 'i');
    const rows = db.prepare('SELECT name, merchant_name FROM transactions').all() as { name: string; merchant_name: string | null }[];
    return rows.filter((r) => re.test(r.name) || (r.merchant_name ? re.test(r.merchant_name) : false)).length;
  } catch { return 0; }
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
  const [statusMsg, setStatusMsg] = useState('');
  const [categories, setCategories] = useState<string[]>(getCategories);

  // Edit panel state
  const [editField, setEditField] = useState<EditField>('name');
  const [editName, setEditName] = useState('');
  const [editCatCursor, setEditCatCursor] = useState(0);
  const [editPattern, setEditPattern] = useState('');
  const [editMatchType, setEditMatchType] = useState<'name' | 'regex'>('name');

  function load(s = search, keepCursor = false) {
    const rows = getTxs(category, month, year, s);
    setTxs(rows);
    if (!keepCursor) setCursor(0);
    else setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }

  useEffect(() => { load(); }, [category, month, year, search]);

  const selected = txs[cursor];

  function openEdit() {
    if (!selected) return;
    const cats = getCategories();
    setCategories(cats);
    setEditName('');
    setEditCatCursor(Math.max(0, cats.indexOf(selected.category)));
    setEditField('name');
    setMode('edit');
  }

  function saveToTransaction() {
    if (!selected) return;
    const newCat = categories[editCatCursor];
    const newDisplay = editName.trim();
    const nameChanged = newDisplay.length > 0;
    const catChanged = newCat !== selected.category;

    if (nameChanged) {
      db.prepare('UPDATE transactions SET display_name = ? WHERE id = ?').run(newDisplay, selected.id);
    }
    if (catChanged) {
      db.prepare('UPDATE transactions SET category = ?, manual_category = ? WHERE id = ?')
        .run(newCat, newCat, selected.id);
    }

    if (nameChanged || catChanged) setStatusMsg('Transaction updated');
    setMode('list');
    setTimeout(() => setStatusMsg(''), 2000);
    load(search, true);
  }

  function saveAsRule() {
    if (!selected) return;
    const newCat = categories[editCatCursor];
    const newDisplay = editName.trim();
    const catChanged = newCat !== selected.category;
    const nameChanged = newDisplay.length > 0;

    const saved: string[] = [];

    if (catChanged) {
      const existing = db.prepare('SELECT id FROM category_rules WHERE match_type = ? AND pattern = ?')
        .get(editMatchType, editPattern) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE category_rules SET category = ? WHERE id = ?').run(newCat, existing.id);
      } else {
        db.prepare('INSERT INTO category_rules (priority, match_type, pattern, category) VALUES (10, ?, ?, ?)')
          .run(editMatchType, editPattern, newCat);
      }
      const count = applyRuleToAll();
      saved.push(`category rule (${count} updated)`);
    }

    if (nameChanged) {
      const existing = db.prepare('SELECT id FROM name_rules WHERE match_type = ? AND pattern = ?')
        .get(editMatchType, editPattern) as { id: number } | undefined;
      if (existing) {
        db.prepare('UPDATE name_rules SET replacement = ? WHERE id = ?').run(newDisplay, existing.id);
      } else {
        db.prepare('INSERT INTO name_rules (match_type, pattern, replacement) VALUES (?, ?, ?)')
          .run(editMatchType, editPattern, newDisplay);
      }
      rebuildDisplayNames();
      saved.push('name rule');
    }

    setStatusMsg(saved.length ? `Saved: ${saved.join(' + ')}` : 'No changes');
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
      if (key.escape) { setSearchInput(''); setSearch(''); setMode('list'); return; }
      if (key.return) { setSearch(searchInput); setMode('list'); return; }
      if (key.backspace || key.delete) {
        const next = searchInput.slice(0, -1);
        setSearchInput(next); setSearch(next); return;
      }
      if (input && !key.ctrl && !key.meta) {
        const next = searchInput + input;
        setSearchInput(next); setSearch(next);
      }
      return;
    }

    if (mode === 'edit') {
      if (key.escape) { setMode('list'); return; }
      if (editField === 'name') {
        // In name field: all keys type except navigation
        if (key.return || key.rightArrow) { setEditField('category'); return; }
        if (key.leftArrow) { return; } // already in name field
        if (key.backspace || key.delete) { setEditName((n) => n.slice(0, -1)); return; }
        if (input && !key.ctrl && !key.meta) { setEditName((n) => n + input); return; }
      } else {
        // In category field: t/r are action keys, not typed
        if (key.leftArrow) { setEditField('name'); return; }
        if (key.upArrow) { setEditCatCursor((c) => Math.max(0, c - 1)); return; }
        if (key.downArrow) { setEditCatCursor((c) => Math.min(categories.length - 1, c + 1)); return; }
        if (input === 't' || key.return) { saveToTransaction(); return; }
        if (input === 'r') {
          setEditPattern(selected?.name ?? '');
          setEditMatchType('name');
          setMode('edit-rule');
          return;
        }
      }
      return;
    }

    if (mode === 'edit-rule') {
      if (key.escape) { setMode('edit'); return; }
      if (input === 'n') { setEditMatchType('name'); return; }
      if (input === 'x') { setEditMatchType('regex'); return; }
      if (key.return) { saveAsRule(); return; }
      if (key.backspace || key.delete) { setEditPattern((p) => p.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setEditPattern((p) => p + input); return; }
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
      if (input === 'e' && selected) openEdit();
      if (input === 'x' && selected?.manual_category) clearOverride();
      if (input === 'i' && selected) toggleIgnored();
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

  // Category list window for edit panel
  const CAT_WIN = 8;
  const catWinStart = Math.max(0, Math.min(editCatCursor - Math.floor(CAT_WIN / 2), categories.length - CAT_WIN));
  const visibleCats = categories.slice(catWinStart, catWinStart + CAT_WIN);

  // Live match count for rule panel
  const matchCount = mode === 'edit-rule' ? countMatches(editPattern, editMatchType) : 0;

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
          {month ? '← → month  ·  ' : ''}[/] search  ·  [u] uncategorized  [a] all  ·  [e] edit  [x] undo  [i] ignore
        </Text>
      </Box>

      {mode === 'search' && (
        <Box marginTop={1}>
          <Text color="cyan">/</Text>
          <Text>{searchInput}</Text>
          <Text color="cyan">█</Text>
          <Text dimColor>  Esc cancel</Text>
        </Box>
      )}
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

      {mode === 'edit' && selected && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
          <Text bold>Edit  <Text dimColor>{selected.name}</Text></Text>

          <Box marginTop={1} gap={3}>
            {/* Name field */}
            <Box flexDirection="column">
              <Text color={editField === 'name' ? 'cyan' : 'gray'} bold>Name</Text>
              {editField === 'name'
                ? <Box><Text color="yellow">{editName || <Text dimColor>type new name…</Text>}</Text><Text color="cyan">█</Text></Box>
                : <Text dimColor>{editName || '(unchanged)'}</Text>
              }
            </Box>

            {/* Category field */}
            <Box flexDirection="column">
              <Text color={editField === 'category' ? 'cyan' : 'gray'} bold>Category</Text>
              {editField === 'category' ? (
                <Box flexDirection="column">
                  {visibleCats.map((cat, i) => {
                    const idx = catWinStart + i;
                    const isSel = idx === editCatCursor;
                    return (
                      <Text key={cat} color={isSel ? 'cyan' : undefined} dimColor={!isSel}>
                        {isSel ? '▶ ' : '  '}{cat}
                      </Text>
                    );
                  })}
                </Box>
              ) : (
                <Text color="cyan">{categories[editCatCursor]}</Text>
              )}
            </Box>
          </Box>

          <Box marginTop={1} gap={3}>
            {editField === 'name'
              ? <Text dimColor>Enter / → to pick category  ·  Esc cancel</Text>
              : <><Text color="cyan">[t] / Enter  this transaction</Text><Text color="cyan">[r] make rule</Text><Text dimColor>← name  ·  Esc cancel</Text></>
            }
          </Box>
        </Box>
      )}

      {mode === 'edit-rule' && selected && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
          <Text bold>Make Rule</Text>
          {categories[editCatCursor] !== selected.category && (
            <Text dimColor>Category: <Text color="red">{selected.category}</Text> → <Text color="cyan">{categories[editCatCursor]}</Text></Text>
          )}
          {editName.trim().length > 0 && (
            <Text dimColor>Name: <Text color="green">{editName}</Text></Text>
          )}

          <Box gap={2} marginTop={1}>
            <Text>Pattern </Text>
            <Text color="magenta">{editPattern}</Text><Text color="magenta">█</Text>
          </Box>
          <Box gap={3} marginTop={1}>
            <Text color={editMatchType === 'name' ? 'white' : undefined} dimColor={editMatchType !== 'name'}>[n] name</Text>
            <Text color={editMatchType === 'regex' ? 'white' : undefined} dimColor={editMatchType !== 'regex'}>[x] regex</Text>
            <Text color="yellow">{matchCount} transactions match</Text>
          </Box>
          <Text dimColor marginTop={1}>Enter save  ·  Esc back</Text>
        </Box>
      )}
    </Box>
  );
}
