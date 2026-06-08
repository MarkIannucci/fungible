import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getFilterOptions, type FilterOptions } from '../core/queries.js';
import { useFilter } from './FilterContext.js';
import { selectionToDim, selectionFromDim, type Filter, type TagPredicate } from '../core/filters.js';
import { ModalPanel } from './components/index.js';
import { C_ACCENT, C_POSITIVE, C_NEGATIVE, C_DIM } from './ui.js';

// Global, session-wide filter panel. Opens over any screen; reads the current
// shared filter into a draft, lets you adjust all four dimensions, and writes it
// back via setFilter on apply. Categories/accounts/owners use a select-from-
// universe model (everything selected → no constraint); tags are tri-state
// (off / has / lacks) matching the TagPredicate model.

type Section = 'categories' | 'accounts' | 'owners' | 'tags';
const SECTION_LABEL: Record<Section, string> = {
  categories: 'Categories', accounts: 'Accounts', owners: 'Owners', tags: 'Tags',
};

type Row =
  | { kind: 'header'; section: Section }
  | { kind: 'item'; section: Section; key: string; label: string; sub?: string };

const WINDOW = 16;

export function FilterPanel({ isActive, onClose }: { isActive: boolean; onClose: () => void }) {
  const { filter, setFilter } = useFilter();
  const [opts, setOpts] = useState<FilterOptions | null>(null);

  // Draft selection state. Sets hold the *selected* members of each universe;
  // tagModes maps a tag name to its predicate ('has'/'lacks'), absent = off.
  const [catSel, setCatSel] = useState<Set<string>>(new Set());
  const [acctSel, setAcctSel] = useState<Set<string>>(new Set());
  const [ownerSel, setOwnerSel] = useState<Set<string>>(new Set());
  const [tagModes, setTagModes] = useState<Map<string, 'has' | 'lacks'>>(new Map());
  const [cursor, setCursor] = useState(0);

  // Load options + hydrate the draft from the current shared filter on open.
  useEffect(() => {
    void getFilterOptions().then((o) => {
      setOpts(o);
      setCatSel(selectionFromDim(filter.categories, o.categories));
      setAcctSel(selectionFromDim(filter.accounts, o.accounts.map((a) => a.id)));
      setOwnerSel(selectionFromDim(filter.owners, o.owners));
      setTagModes(new Map((filter.tags ?? []).map((t) => [t.name, t.mode])));
      setCursor(0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flattened row list (headers + items) and the indices that are selectable.
  const rows: Row[] = [];
  if (opts) {
    rows.push({ kind: 'header', section: 'categories' });
    for (const c of opts.categories) rows.push({ kind: 'item', section: 'categories', key: c, label: c });
    rows.push({ kind: 'header', section: 'accounts' });
    for (const a of opts.accounts) rows.push({ kind: 'item', section: 'accounts', key: a.id, label: a.name, sub: a.owner });
    rows.push({ kind: 'header', section: 'owners' });
    for (const o of opts.owners) rows.push({ kind: 'item', section: 'owners', key: o, label: o });
    rows.push({ kind: 'header', section: 'tags' });
    for (const t of opts.tags) rows.push({ kind: 'item', section: 'tags', key: t, label: t });
  }
  const selectable = rows.map((r, i) => (r.kind === 'item' ? i : -1)).filter((i) => i >= 0);
  const cursorRowIdx = selectable[Math.min(cursor, Math.max(0, selectable.length - 1))] ?? 0;
  const current = rows[cursorRowIdx];
  const currentSection: Section | null = current?.kind === 'item' ? current.section : null;

  function selForSection(s: Section): [Set<string>, (next: Set<string>) => void] {
    if (s === 'categories') return [catSel, setCatSel];
    if (s === 'accounts') return [acctSel, setAcctSel];
    return [ownerSel, setOwnerSel];
  }
  function universeForSection(s: Section): string[] {
    if (!opts) return [];
    if (s === 'categories') return opts.categories;
    if (s === 'accounts') return opts.accounts.map((a) => a.id);
    return opts.owners;
  }

  function toggleCurrent() {
    if (current?.kind !== 'item') return;
    if (current.section === 'tags') {
      setTagModes((m) => {
        const n = new Map(m);
        const cur = n.get(current.key);
        if (cur === undefined) n.set(current.key, 'has');
        else if (cur === 'has') n.set(current.key, 'lacks');
        else n.delete(current.key);
        return n;
      });
      return;
    }
    const [sel, set] = selForSection(current.section);
    const n = new Set(sel);
    if (n.has(current.key)) n.delete(current.key); else n.add(current.key);
    set(n);
  }

  function bulk(all: boolean) {
    if (!currentSection) return;
    if (currentSection === 'tags') {
      if (!all) setTagModes(new Map());
      return;
    }
    const [, set] = selForSection(currentSection);
    set(all ? new Set(universeForSection(currentSection)) : new Set());
  }

  function clearAll() {
    if (!opts) return;
    setCatSel(new Set(opts.categories));
    setAcctSel(new Set(opts.accounts.map((a) => a.id)));
    setOwnerSel(new Set(opts.owners));
    setTagModes(new Map());
  }

  function apply() {
    if (!opts) { onClose(); return; }
    const tags: TagPredicate[] = [...tagModes.entries()].map(([name, mode]) => ({ name, mode }));
    const next: Filter = {};
    const cats = selectionToDim(catSel, opts.categories);
    const accts = selectionToDim(acctSel, opts.accounts.map((a) => a.id));
    const owners = selectionToDim(ownerSel, opts.owners);
    if (cats !== undefined) next.categories = cats;
    if (accts !== undefined) next.accounts = accts;
    if (owners !== undefined) next.owners = owners;
    if (tags.length) next.tags = tags;
    setFilter(next);
    onClose();
  }

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.return) { apply(); return; }
    if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor((c) => Math.min(selectable.length - 1, c + 1)); return; }
    if (input === ' ') { toggleCurrent(); return; }
    if (input === 'A') { bulk(true); return; }
    if (input === 'N') { bulk(false); return; }
    if (input === 'c') { clearAll(); return; }
  }, { isActive });

  if (!opts) return null;

  // Window the row list around the cursor so a long universe stays bounded.
  const winStart = Math.max(0, Math.min(cursorRowIdx - Math.floor(WINDOW / 2), rows.length - WINDOW));
  const visible = rows.slice(winStart, winStart + WINDOW);

  function sectionCount(s: Section): string {
    if (s === 'tags') {
      const n = [...tagModes.values()].length;
      return n ? ` (${n})` : '';
    }
    const [sel] = selForSection(s);
    const total = universeForSection(s).length;
    return sel.size === total ? ' (all)' : ` (${sel.size}/${total})`;
  }

  return (
    <ModalPanel title="Filter" borderColor={C_ACCENT}>
      <Text dimColor>
        ↑↓ move  ·  Space toggle  ·  A all  ·  N none  ·  c clear  ·  Enter apply  ·  Esc cancel
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((row, i) => {
          const idx = winStart + i;
          if (row.kind === 'header') {
            return (
              <Box key={`h-${row.section}`} marginTop={i === 0 ? 0 : 1}>
                <Text bold color={currentSection === row.section ? C_ACCENT : undefined}>
                  {SECTION_LABEL[row.section]}{sectionCount(row.section)}
                </Text>
              </Box>
            );
          }
          const isCursor = idx === cursorRowIdx;
          let mark: React.ReactNode;
          if (row.section === 'tags') {
            const mode = tagModes.get(row.key);
            mark = mode === 'has'
              ? <Text color={C_POSITIVE}>✓ has  </Text>
              : mode === 'lacks'
                ? <Text color={C_NEGATIVE}>✗ lacks</Text>
                : <Text dimColor>○ off  </Text>;
          } else {
            const [sel] = selForSection(row.section);
            mark = sel.has(row.key)
              ? <Text color={C_POSITIVE}>●</Text>
              : <Text dimColor>○</Text>;
          }
          return (
            <Box key={`${row.section}-${row.key}`}>
              <Text color={isCursor ? C_ACCENT : undefined}>{isCursor ? '▶ ' : '  '}</Text>
              <Box gap={1}>
                {mark}
                <Text color={isCursor ? C_ACCENT : undefined} dimColor={!isCursor}>{row.label}</Text>
                {row.sub ? <Text color={C_DIM}>{row.sub}</Text> : null}
              </Box>
            </Box>
          );
        })}
      </Box>
    </ModalPanel>
  );
}
