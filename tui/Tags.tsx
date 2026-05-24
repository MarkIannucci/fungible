import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import { getTagSummary, type MonthlySummary } from '../core/queries.js';
import type { Screen, TxFilter } from './App.js';

type Tag = { id: number; name: string; count: number };
type Mode = 'list' | 'add' | 'detail';

const BAR_WIDTH = 20;

function fmt(amount: number) {
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bar(amount: number, max: number) {
  const filled = Math.round((amount / max) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

function getTags(): Tag[] {
  return db.prepare(`
    SELECT t.id, t.name, COUNT(tt.transaction_id) as count
    FROM tags t
    LEFT JOIN transaction_tags tt ON tt.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `).all() as Tag[];
}

export function Tags({ onNavigate }: { onNavigate: (s: Screen, f?: TxFilter) => void }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [newName, setNewName] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [tagSummary, setTagSummary] = useState<MonthlySummary | null>(null);
  const [catCursor, setCatCursor] = useState(0);

  function load() { setTags(getTags()); }
  useEffect(() => { load(); }, []);

  function openDetail(tag: Tag) {
    setTagSummary(getTagSummary(tag.name));
    setCatCursor(0);
    setMode('detail');
  }

  useInput((input, key) => {
    if (mode === 'add') {
      if (key.escape) { setMode('list'); setNewName(''); return; }
      if (key.return && newName.trim()) {
        db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(newName.trim());
        setNewName('');
        setMode('list');
        load();
        return;
      }
      if (key.backspace || key.delete) { setNewName((n) => n.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setNewName((n) => n + input); return; }
      return;
    }

    if (mode === 'detail') {
      if (key.escape) { setMode('list'); return; }
      if (key.leftArrow) {
        const next = Math.max(0, cursor - 1);
        setCursor(next);
        if (tags[next]) { setTagSummary(getTagSummary(tags[next].name)); setCatCursor(0); }
        return;
      }
      if (key.rightArrow) {
        const next = Math.min(tags.length - 1, cursor + 1);
        setCursor(next);
        if (tags[next]) { setTagSummary(getTagSummary(tags[next].name)); setCatCursor(0); }
        return;
      }
      if (key.upArrow) { setCatCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setCatCursor((c) => Math.min((tagSummary?.byCategory.length ?? 1) - 1, c + 1)); return; }
      if (key.return) {
        const tag = tags[cursor];
        const cat = tagSummary?.byCategory[catCursor];
        if (tag) onNavigate('transactions', { tag: tag.name, category: cat?.category });
        return;
      }
      if (input === 't' && tags[cursor]) {
        onNavigate('transactions', { tag: tags[cursor].name });
        return;
      }
      if (input === '1') { onNavigate('dashboard'); return; }
      if (input === '2') { onNavigate('transactions'); return; }
      if (input === '3') { onNavigate('trends'); return; }
      if (input === '4') { onNavigate('networth'); return; }
      if (input === '6') { onNavigate('health'); return; }
      if (input === '7') { onNavigate('rules'); return; }
      if (input === '8') { onNavigate('accounts'); return; }
      return;
    }

    // list mode
    if (input === '1') { onNavigate('dashboard'); return; }
    if (input === '2') { onNavigate('transactions'); return; }
    if (input === '3') { onNavigate('trends'); return; }
    if (input === '4') { onNavigate('networth'); return; }
    if (input === '6') { onNavigate('health'); return; }
    if (input === '7') { onNavigate('rules'); return; }
    if (input === '8') { onNavigate('accounts'); return; }
    if (key.escape) { onNavigate('dashboard'); return; }
    if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor((c) => Math.min(tags.length - 1, c + 1)); return; }
    if (input === 'a') { setNewName(''); setMode('add'); return; }
    if (input === 'd' && tags[cursor]) {
      const tag = tags[cursor];
      db.prepare('DELETE FROM transaction_tags WHERE tag_id = ?').run(tag.id);
      db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
      setStatusMsg(`Deleted "${tag.name}"`);
      setTimeout(() => setStatusMsg(''), 2000);
      setCursor((c) => Math.max(0, c - 1));
      load();
      return;
    }
    if (key.return && tags[cursor]) {
      openDetail(tags[cursor]);
      return;
    }
    if (input === 't' && tags[cursor]) {
      onNavigate('transactions', { tag: tags[cursor].name });
      return;
    }
  });

  const tag = tags[cursor];
  const maxCategorySpend = tagSummary?.byCategory[0]?.total ?? 1;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [2] txns  [3] trends  [4] worth  [6] health  [7] rules  [8] accounts</Text>
      </Box>

      {mode === 'detail' && tag && tagSummary ? (
        <>
          <Box justifyContent="space-between" marginTop={1} marginBottom={1}>
            <Text bold># {tag.name} <Text dimColor>← {cursor + 1} / {tags.length} →</Text></Text>
            <Text dimColor>← → tag  ·  ↑↓ category  ·  Enter txns  ·  [t] all txns  ·  Esc back</Text>
          </Box>

          <Text dimColor>{'─'.repeat(60)}</Text>

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
            <Box flexDirection="column">
              <Text dimColor>Transactions</Text>
              <Text bold>{tag.count}</Text>
            </Box>
          </Box>

          <Text dimColor>{'─'.repeat(60)}</Text>

          <Box flexDirection="column" marginTop={1}>
            <Text bold dimColor>SPENDING BY CATEGORY</Text>
            <Box flexDirection="column" marginTop={1}>
              {tagSummary.byCategory.length === 0 ? (
                <Text dimColor>No expense data for this tag.</Text>
              ) : (
                tagSummary.byCategory.map((row, i) => {
                  const isSelected = catCursor === i;
                  return (
                    <Box key={row.category} gap={2}>
                      <Text color={isSelected ? 'cyan' : undefined}>
                        {isSelected ? '▶ ' : '  '}
                        {row.category.padEnd(20)}
                      </Text>
                      <Text color="yellow">{fmt(row.total).padStart(10)}</Text>
                      <Text color="cyan" dimColor={!isSelected}>{bar(row.total, maxCategorySpend)}</Text>
                    </Box>
                  );
                })
              )}
            </Box>
          </Box>
        </>
      ) : (
        <>
          <Box justifyContent="space-between" marginTop={1}>
            <Text bold>Tags</Text>
            <Text dimColor>[a] add  [d] delete  ·  Enter detail  ·  [t] transactions</Text>
          </Box>
          <Box marginTop={1}><Text dimColor>{'─'.repeat(50)}</Text></Box>

          {tags.length === 0 ? (
            <Box marginTop={1}><Text dimColor>No tags yet. [a] to create one.</Text></Box>
          ) : (
            tags.map((t, i) => {
              const isSelected = i === cursor;
              return (
                <Box key={t.id} gap={2} marginTop={i === 0 ? 1 : 0}>
                  <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '▶ ' : '  '}</Text>
                  <Text color={isSelected ? 'cyan' : undefined} dimColor={!isSelected}>
                    {t.name.padEnd(28)}
                  </Text>
                  <Text dimColor>{t.count} transaction{t.count !== 1 ? 's' : ''}</Text>
                </Box>
              );
            })
          )}

          <Box marginTop={1}><Text dimColor>{'─'.repeat(50)}</Text></Box>
          <Text dimColor>{tags.length} tag{tags.length !== 1 ? 's' : ''}</Text>
          {statusMsg && <Text color="green">{statusMsg}</Text>}

          {mode === 'add' && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
              <Text bold>New Tag</Text>
              <Text dimColor>Type name · Enter save · Esc cancel</Text>
              <Box marginTop={1}>
                <Text>Name: </Text>
                <Text color="yellow">{newName}</Text>
                <Text color="cyan">█</Text>
              </Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
