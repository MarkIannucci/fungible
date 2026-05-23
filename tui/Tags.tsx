import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { db } from '../core/db.js';
import type { Screen, TxFilter } from './App.js';

type Tag = { id: number; name: string; count: number };

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
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [newName, setNewName] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  function load() { setTags(getTags()); }
  useEffect(() => { load(); }, []);

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

    if (input === '1') { onNavigate('dashboard'); return; }
    if (input === '2') { onNavigate('transactions'); return; }
    if (input === '3') { onNavigate('rules'); return; }
    if (input === '4') { onNavigate('import'); return; }
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
    if ((key.return || input === 'e') && tags[cursor]) {
      onNavigate('transactions', { tag: tags[cursor].name });
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [2] txns  [3] rules  [4] import</Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Text bold>Tags</Text>
        <Text dimColor>[a] add  [d] delete  ·  Enter view transactions</Text>
      </Box>
      <Text dimColor marginTop={1}>{'─'.repeat(50)}</Text>

      {tags.length === 0 ? (
        <Text dimColor marginTop={1}>No tags yet. [a] to create one.</Text>
      ) : (
        tags.map((tag, i) => {
          const isSelected = i === cursor;
          return (
            <Box key={tag.id} gap={2} marginTop={i === 0 ? 1 : 0}>
              <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '▶ ' : '  '}</Text>
              <Text color={isSelected ? 'cyan' : undefined} dimColor={!isSelected}>
                {tag.name.padEnd(28)}
              </Text>
              <Text dimColor>{tag.count} transaction{tag.count !== 1 ? 's' : ''}</Text>
            </Box>
          );
        })
      )}

      <Text dimColor marginTop={1}>{'─'.repeat(50)}</Text>
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
    </Box>
  );
}
