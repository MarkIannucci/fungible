import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { db } from '../core/db.js';
import { categorize } from '../core/categorize.js';
import { syncAll, removeLink } from '../core/sync.js';
import { setAccountDefaultTag, applyDefaultTagToAccount, tagExists } from '../core/accountTags.js';
import { getCsvPlaidDupeCandidates, type DupePair } from '../core/dedup.js';
import { parseCSV, parseDate, generateTxId } from '../core/csv.js';
import { getLinkedAccounts, getCsvAccounts, getPlaidLinks, type LinkedAccount, type CsvAccount, type PlaidLink } from '../core/queries.js';
import type { Screen, TxFilter } from './App.js';
import { truncate, Divider } from './fmt.js';
import { NavHints, handleNavKey } from './nav.js';
import { useTerminalWidth } from './useTerminalWidth.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type MainView = 'accounts' | 'add-data' | 'plaid-links' | 'dupes';
type AcctMode = 'list' | 'edit' | 'update-value' | 'nickname' | 'owner' | 'default-tag' | 'default-tag-confirm' | 'confirm-delete';
type EditField = 'type' | 'subtype';

type AddStep =
  | 'landing'
  | 'link-days'
  | 'link-plaid'
  | 'file'
  | 'map-date'
  | 'map-name'
  | 'map-amount-mode'
  | 'map-amount'
  | 'map-debit'
  | 'map-credit'
  | 'direction'
  | 'account'
  | 'confirm'
  | 'done'
  | 'manual-name'
  | 'manual-value'
  | 'manual-confirm'
  | 'manual-done'
  | 'create-acct-name'
  | 'create-acct-type'
  | 'create-acct-done';

const ACCOUNT_TYPES = ['depository', 'investment', 'credit', 'loan', 'other'] as const;

const SUBTYPES: Record<string, string[]> = {
  depository:  ['checking', 'savings', 'money market', 'cd', 'hsa', 'prepaid', 'cash management', 'ebt', 'paypal'],
  investment:  ['brokerage', '401k', 'ira', 'roth', 'roth 401k', '403b', '457b', '529', 'hsa', 'pension', 'mutual fund', 'stock plan', 'sep ira', 'simple ira', 'thrift savings plan', 'ugma', 'utma'],
  credit:      ['credit card', 'paypal'],
  loan:        ['mortgage', 'student', 'auto', 'home equity', 'personal', 'line of credit', 'business', 'other'],
  other:       [],
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDaysRequested(raw: string): { days: number } | { error: string } {
  const n = parseInt(raw.trim(), 10);
  if (isNaN(n) || String(n) !== raw.trim()) return { error: 'Enter a whole number' };
  if (n < 30 || n > 730) return { error: 'Must be between 30 and 730 days' };
  return { days: n };
}

function fmtDate(d: string | null): string {
  if (!d) return 'never';
  const dt = new Date(d + 'T12:00:00');
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Accounts({ onNavigate, isActive, showHints }: { onNavigate: (s: Screen, f?: TxFilter) => void; isActive?: boolean; showHints: boolean }) {
  // Main view toggle
  const [mainView, setMainView] = useState<MainView>('accounts');

  // Accounts view state
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [acctCursor, setAcctCursor] = useState(0);
  const [acctMode, setAcctMode] = useState<AcctMode>('list');
  const [editField, setEditField] = useState<EditField>('type');
  const [editType, setEditType] = useState('');
  const [editSubtype, setEditSubtype] = useState('');
  const [acctMsg, setAcctMsg] = useState('');

  // Sync state (shared)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [syncMsg, setSyncMsg] = useState('');

  // Add-data / link state
  const [addStep, setAddStep] = useState<AddStep>('landing');
  const [linkStatus, setLinkStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [linkMsg, setLinkMsg] = useState('');
  const [daysInput, setDaysInput] = useState('180');
  const [daysError, setDaysError] = useState('');

  // CSV import state
  const [filePath, setFilePath] = useState('');
  const [fileError, setFileError] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [colCursor, setColCursor] = useState(0);
  const [dateCol, setDateCol] = useState<number | null>(null);
  const [nameCol, setNameCol] = useState<number | null>(null);
  const [amountMode, setAmountMode] = useState<'single' | 'split'>('single');
  const [amountCol, setAmountCol] = useState<number | null>(null);
  const [debitCol, setDebitCol] = useState<number | null>(null);
  const [creditCol, setCreditCol] = useState<number | null>(null);
  const [positiveIsInflow, setPositiveIsInflow] = useState(false);
  const [csvAccountCursor, setCsvAccountCursor] = useState(0);
  const [csvAccounts, setCsvAccounts] = useState<CsvAccount[]>([]);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  // Manual asset state
  const [manualName, setManualName] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [manualValueError, setManualValueError] = useState('');

  // Create account state
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState('credit');
  const [createSubtype, setCreateSubtype] = useState('credit card');
  const [createField, setCreateField] = useState<'type' | 'subtype'>('type');

  // Update-value mode state
  const [updateValueInput, setUpdateValueInput] = useState('');
  const [updateValueError, setUpdateValueError] = useState('');

  // Nickname mode state
  const [nicknameInput, setNicknameInput] = useState('');

  // Owner mode state
  const [ownerInput, setOwnerInput] = useState('');

  // Default-tag mode state
  const [tagInput, setTagInput] = useState('');
  const [pendingTagName, setPendingTagName] = useState('');

  // Dupes view state
  const [dupes, setDupes] = useState<DupePair[]>([]);
  const [dupeCursor, setDupeCursor] = useState(0);

  // Links view state
  const [links, setLinks] = useState<PlaidLink[]>([]);
  const [linkCursor, setLinkCursor] = useState(0);
  const [linkMode, setLinkMode] = useState<'list' | 'confirm-remove' | 'change-history'>('list');
  const [removeMsg, setRemoveMsg] = useState('');

  const termW = useTerminalWidth();
  const inner = Math.max(60, termW) - 4;
  // [sel=2] gap [name] gap [✎=1] gap [mask=7] gap [type=14] gap [inst] gap [synced~14]
  // 6 gaps of 2 = 12; fixed: 2+1+7+14+14+12 = 50
  const acctFlex = Math.max(20, inner - 50);
  const acctNameW = Math.max(14, Math.floor(acctFlex * 0.6));
  const acctInstW = Math.max(8,  acctFlex - acctNameW);

  function loadAccounts() {
    setLinkedAccounts(getLinkedAccounts());
    setDupes(getCsvPlaidDupeCandidates());
    setLinks(getPlaidLinks());
  }
  useEffect(() => { loadAccounts(); }, []);

  function openEdit(acct: LinkedAccount) {
    const type = acct.type;
    const subtypes = SUBTYPES[type] ?? [];
    // Snap to a known subtype if possible, otherwise first option
    const currentSub = acct.subtype ?? '';
    const snapped = subtypes.includes(currentSub) ? currentSub : (subtypes[0] ?? '');
    setEditType(type);
    setEditSubtype(snapped);
    setEditField('type');
    setAcctMode('edit');
  }

  function saveEdit() {
    const acct = linkedAccounts[acctCursor];
    if (!acct) return;
    db.prepare('UPDATE accounts SET type = ?, subtype = ? WHERE id = ?')
      .run(editType, editSubtype.trim() || null, acct.id);
    setAcctMode('list');
    setAcctMsg(`Updated ${acct.name}`);
    setTimeout(() => setAcctMsg(''), 2500);
    loadAccounts();
  }

  function forceSync() {
    setSyncStatus('syncing');
    setSyncMsg('Syncing…');
    syncAll(true).then((results) => {
      const added = results.reduce((s, r) => s + r.added, 0);
      setSyncMsg(`Done — ${added} new transaction${added !== 1 ? 's' : ''}`);
      setSyncStatus('done');
      loadAccounts();
      setTimeout(() => { setSyncStatus('idle'); setSyncMsg(''); }, 4000);
    }).catch(() => {
      setSyncMsg('Sync failed');
      setSyncStatus('done');
      setTimeout(() => { setSyncStatus('idle'); setSyncMsg(''); }, 3000);
    });
  }

  function saveManualAsset() {
    const value = parseFloat(manualValue.replace(/[$,]/g, ''));
    if (isNaN(value) || value < 0) { setManualValueError('Enter a valid positive number'); return; }
    const id = `manual-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT INTO accounts (id, name, type, subtype) VALUES (?, ?, ?, ?)').run(id, manualName.trim(), 'other', 'manual');
    db.prepare('INSERT OR REPLACE INTO balance_history (account_id, balance, date) VALUES (?, ?, ?)').run(id, value, today);
    setAddStep('manual-done');
    loadAccounts();
  }

  function saveNewAccount() {
    const id = `csv-acct-${Date.now()}`;
    db.prepare('INSERT INTO accounts (id, name, type, subtype) VALUES (?, ?, ?, ?)')
      .run(id, createName.trim(), createType, createSubtype.trim() || null);
    setAddStep('create-acct-done');
    loadAccounts();
  }

  function deleteAccount() {
    const acct = linkedAccounts[acctCursor];
    if (!acct) return;
    if (acct.item_id) {
      db.prepare('INSERT OR IGNORE INTO excluded_plaid_accounts (account_id) VALUES (?)').run(acct.id);
    }
    db.prepare('DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE account_id = ?)').run(acct.id);
    db.prepare('DELETE FROM transactions WHERE account_id = ?').run(acct.id);
    db.prepare('DELETE FROM balance_history WHERE account_id = ?').run(acct.id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(acct.id);
    setAcctMode('list');
    setAcctCursor((c) => Math.max(0, c - 1));
    setAcctMsg(`Deleted ${acct.nickname ?? acct.name}`);
    setTimeout(() => setAcctMsg(''), 2500);
    loadAccounts();
  }

  function doRemoveLink() {
    const link = links[linkCursor];
    if (!link) return;
    setLinkMode('list');
    setRemoveMsg('Removing…');
    removeLink(link.item_id).then((res) => {
      const inst = link.institution_name ?? 'link';
      setRemoveMsg(res.plaidRemoved ? `Removed ${inst}` : `Removed ${inst} locally (Plaid removal failed)`);
      setLinkCursor((c) => Math.max(0, c - 1));
      loadAccounts();
      setTimeout(() => setRemoveMsg(''), 4000);
    }).catch(() => {
      setRemoveMsg('Failed to remove link');
      setTimeout(() => setRemoveMsg(''), 3000);
    });
  }

  function saveNickname() {
    const acct = linkedAccounts[acctCursor];
    if (!acct) return;
    const nickname = nicknameInput.trim() || null;
    db.prepare('UPDATE accounts SET nickname = ? WHERE id = ?').run(nickname, acct.id);
    setAcctMode('list');
    setAcctMsg(nickname ? `Nickname set to "${nickname}"` : 'Nickname cleared');
    setTimeout(() => setAcctMsg(''), 2500);
    loadAccounts();
  }

  function saveOwner() {
    const acct = linkedAccounts[acctCursor];
    if (!acct) return;
    const owner = ownerInput.trim() || null;
    db.prepare('UPDATE accounts SET owner = ? WHERE id = ?').run(owner, acct.id);
    setAcctMode('list');
    setAcctMsg(owner ? `Owner set to "${owner}"` : 'Owner cleared');
    setTimeout(() => setAcctMsg(''), 2500);
    loadAccounts();
  }

  function applyDefaultTag(name: string | null) {
    const acct = linkedAccounts[acctCursor];
    if (!acct) return;
    const r = setAccountDefaultTag(acct.id, name);
    let msg: string;
    if (!r.newTag) {
      msg = r.oldTag ? `Removed "${r.oldTag}" from ${r.removed} txn${r.removed !== 1 ? 's' : ''}` : 'Default tag cleared';
    } else {
      msg = `Tagged ${r.tagged} txn${r.tagged !== 1 ? 's' : ''} as "${r.newTag}"`;
      if (r.created) msg += ' (created tag)';
      if (r.oldTag && r.oldTag !== r.newTag) msg += `; removed "${r.oldTag}" from ${r.removed}`;
    }
    setAcctMode('list');
    setTagInput('');
    setPendingTagName('');
    setAcctMsg(msg);
    setTimeout(() => setAcctMsg(''), 4000);
    loadAccounts();
  }

  function submitDefaultTag() {
    const name = tagInput.trim();
    if (!name) { applyDefaultTag(null); return; }
    if (tagExists(name)) { applyDefaultTag(name); return; }
    setPendingTagName(name);
    setAcctMode('default-tag-confirm');
  }

  function saveUpdatedValue() {
    const acct = linkedAccounts[acctCursor];
    if (!acct) return;
    const value = parseFloat(updateValueInput.replace(/[$,]/g, ''));
    if (isNaN(value) || value < 0) { setUpdateValueError('Enter a valid positive number'); return; }
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT OR REPLACE INTO balance_history (account_id, balance, date) VALUES (?, ?, ?)').run(acct.id, value, today);
    setAcctMode('list');
    setAcctMsg(`Updated value for ${acct.name}`);
    setTimeout(() => setAcctMsg(''), 2500);
    loadAccounts();
  }

  function startPlaidLink(days = 180, removeOldItemId?: string) {
    setLinkStatus('running');
    setLinkMsg('Opening browser…');
    let newItemId: string | null = null;
    const node = process.execPath;
    const script = new URL('../scripts/link.ts', import.meta.url).pathname;
    const child = spawn(node, [
      '--experimental-sqlite', '--no-warnings',
      '--import', 'tsx/esm',
      script,
    ], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, PLAID_DAYS_REQUESTED: String(days) },
    });
    child.stdout.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('ITEM_ID:')) {
          newItemId = trimmed.slice('ITEM_ID:'.length);
        } else {
          setLinkMsg(trimmed);
        }
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      setLinkStatus('error');
      setLinkMsg(data.toString().trim());
    });
    child.on('close', async (code: number) => {
      if (code === 0) {
        // Backfill: only wipe the old Item after the new one is in place, and never
        // if Plaid handed back the same Item.
        if (removeOldItemId && newItemId && newItemId !== removeOldItemId) {
          try { await removeLink(removeOldItemId); } catch {}
        }
        setLinkStatus('done');
        setLinkMsg('Bank connected! Press Enter to continue.');
        loadAccounts();
      } else if (code !== null) {
        setLinkStatus('error');
        setLinkMsg(`Process exited with code ${code}. Press Enter to continue.`);
      }
    });
  }

  function tryLoadFile(path: string) {
    try {
      const parsed = parseCSV(path.trim());
      if (!parsed.headers.length) { setFileError('No columns found'); return; }
      setHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      setFileError('');
      const h = parsed.headers.map((x) => x.toLowerCase());
      const dateGuess = h.findIndex((x) => x.includes('date') || x.includes('posted'));
      const nameGuess = h.findIndex((x) => x.includes('desc') || x.includes('name') || x.includes('merchant'));
      if (dateGuess >= 0) setDateCol(dateGuess);
      if (nameGuess >= 0) setNameCol(nameGuess);
      setColCursor(0);
      setAddStep('map-date');
    } catch (e: any) {
      setFileError(e.message);
    }
  }

  function doImport() {
    const acct = csvAccounts[csvAccountCursor];
    const insert = db.prepare(`
      INSERT OR IGNORE INTO transactions (id, account_id, date, name, amount, category, raw_category, pending)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 0)
    `);
    let imported = 0, skipped = 0;
    for (const row of csvRows) {
      const rawDate = row[dateCol!] ?? '';
      const name = row[nameCol!] ?? '';
      let amount: number;
      if (amountMode === 'split') {
        const debit = parseFloat(row[debitCol!] || '0') || 0;
        const credit = parseFloat(row[creditCol!] || '0') || 0;
        amount = debit > 0 ? debit : -credit;
      } else {
        const raw = parseFloat(row[amountCol!] || '0') || 0;
        amount = positiveIsInflow ? -raw : raw;
      }
      if (!rawDate || !name || isNaN(amount)) { skipped++; continue; }
      const date = parseDate(rawDate);
      const category = categorize(name, null, null);
      const id = generateTxId(acct.mask ?? acct.id, date, name, amount);
      const changes = (insert.run(id, acct.id, date, name, amount, category) as any).changes;
      if (changes > 0) imported++; else skipped++;
    }
    applyDefaultTagToAccount(acct.id);
    setImportResult({ imported, skipped });
    setAddStep('done');
  }

  function previewRow(row: string[]) {
    const date = dateCol !== null ? parseDate(row[dateCol] ?? '') : '—';
    const name = nameCol !== null ? truncate(row[nameCol] ?? '', 28) : '—';
    let amount = '—';
    if (amountMode === 'single' && amountCol !== null) {
      const raw = parseFloat(row[amountCol] || '0') || 0;
      const v = positiveIsInflow ? -raw : raw;
      amount = `$${Math.abs(v).toFixed(2)}`;
    } else if (amountMode === 'split' && debitCol !== null && creditCol !== null) {
      const d = parseFloat(row[debitCol] || '0') || 0;
      const c = parseFloat(row[creditCol] || '0') || 0;
      amount = `$${Math.abs(d > 0 ? d : c).toFixed(2)}`;
    }
    return { date, name, amount };
  }

  // ─── Input handling ──────────────────────────────────────────────────────────

  useInput((input, key) => {
    // Global nav (only when not deep in a multi-step flow)
    const atTop = (mainView === 'accounts' && acctMode === 'list') || (mainView === 'add-data' && addStep === 'landing');

    if (atTop) {
      if (handleNavKey(input, 'accounts', onNavigate)) return;
    }

    // ── Accounts view ──────────────────────────────────────────────────────────
    if (mainView === 'accounts') {
      if (acctMode === 'edit') {
        if (key.escape) { setAcctMode('list'); return; }
        if (key.return) { saveEdit(); return; }
        if (key.tab) {
          setEditField((f) => f === 'type' ? 'subtype' : 'type');
          return;
        }
        if (editField === 'type') {
          if (key.leftArrow || key.rightArrow) {
            const idx = ACCOUNT_TYPES.indexOf(editType as typeof ACCOUNT_TYPES[number]);
            const dir = key.leftArrow ? -1 : 1;
            const nextType = ACCOUNT_TYPES[(idx + dir + ACCOUNT_TYPES.length) % ACCOUNT_TYPES.length];
            setEditType(nextType);
            setEditSubtype(SUBTYPES[nextType]?.[0] ?? '');
          }
          return;
        }
        if (editField === 'subtype') {
          const subtypes = SUBTYPES[editType] ?? [];
          if (subtypes.length > 0) {
            if (key.leftArrow || key.rightArrow) {
              const idx = subtypes.indexOf(editSubtype);
              const dir = key.leftArrow ? -1 : 1;
              setEditSubtype(subtypes[(idx + dir + subtypes.length) % subtypes.length]);
            }
          }
          return;
        }
        return;
      }

      if (acctMode === 'update-value') {
        if (key.escape) { setAcctMode('list'); setUpdateValueInput(''); setUpdateValueError(''); return; }
        if (key.return) { saveUpdatedValue(); return; }
        if (key.backspace || key.delete) { setUpdateValueInput((v) => v.slice(0, -1)); setUpdateValueError(''); return; }
        if (input && !key.ctrl && !key.meta) { setUpdateValueInput((v) => v + input); setUpdateValueError(''); return; }
        return;
      }

      if (acctMode === 'nickname') {
        if (key.escape) { setAcctMode('list'); setNicknameInput(''); return; }
        if (key.return) { saveNickname(); return; }
        if (key.backspace || key.delete) { setNicknameInput((v) => v.slice(0, -1)); return; }
        if (input && !key.ctrl && !key.meta) { setNicknameInput((v) => v + input); return; }
        return;
      }

      if (acctMode === 'owner') {
        if (key.escape) { setAcctMode('list'); setOwnerInput(''); return; }
        if (key.return) { saveOwner(); return; }
        if (key.backspace || key.delete) { setOwnerInput((v) => v.slice(0, -1)); return; }
        if (input && !key.ctrl && !key.meta) { setOwnerInput((v) => v + input); return; }
        return;
      }

      if (acctMode === 'default-tag') {
        if (key.escape) { setAcctMode('list'); setTagInput(''); return; }
        if (key.return) { submitDefaultTag(); return; }
        if (key.backspace || key.delete) { setTagInput((v) => v.slice(0, -1)); return; }
        if (input && !key.ctrl && !key.meta) { setTagInput((v) => v + input); return; }
        return;
      }

      if (acctMode === 'default-tag-confirm') {
        if (key.escape || input === 'n') { setAcctMode('default-tag'); return; }
        if (input === 'y') { applyDefaultTag(pendingTagName); return; }
        return;
      }

      if (acctMode === 'confirm-delete') {
        if (key.escape || input === 'n') { setAcctMode('list'); return; }
        if (input === 'y') { deleteAccount(); return; }
        return;
      }

      // list mode
      if (key.escape) { onNavigate('dashboard'); return; }
      if (key.tab) { setMainView('add-data'); return; }
      if (key.upArrow)   { setAcctCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setAcctCursor((c) => Math.min(linkedAccounts.length - 1, c + 1)); return; }
      if (input === 'e' && linkedAccounts[acctCursor]) {
        openEdit(linkedAccounts[acctCursor]);
        return;
      }
      if (input === 'n' && linkedAccounts[acctCursor]) {
        setNicknameInput(linkedAccounts[acctCursor].nickname ?? '');
        setAcctMode('nickname');
        return;
      }
      if (input === 'o' && linkedAccounts[acctCursor]) {
        setOwnerInput(linkedAccounts[acctCursor].owner ?? '');
        setAcctMode('owner');
        return;
      }
      if (input === 't' && linkedAccounts[acctCursor]) {
        setTagInput(linkedAccounts[acctCursor].default_tag ?? '');
        setPendingTagName('');
        setAcctMode('default-tag');
        return;
      }
      if (input === 'v' && linkedAccounts[acctCursor]?.id.startsWith('manual-')) {
        setUpdateValueInput('');
        setUpdateValueError('');
        setAcctMode('update-value');
        return;
      }
      if (input === 'd' && linkedAccounts[acctCursor]) { setAcctMode('confirm-delete'); return; }
      if (input === 'r' && linkedAccounts[acctCursor]) {
        setMainView('add-data');
        setAddStep('link-plaid');
        startPlaidLink();
        return;
      }
      if (input === 's' && syncStatus === 'idle') { forceSync(); return; }
      return;
    }

    // ── Links view ──────────────────────────────────────────────────────────
    if (mainView === 'plaid-links') {
      if (linkMode === 'confirm-remove') {
        if (key.escape || input === 'n') { setLinkMode('list'); return; }
        if (input === 'y') { doRemoveLink(); return; }
        return;
      }
      if (linkMode === 'change-history') {
        if (key.escape) { setLinkMode('list'); setDaysError(''); return; }
        if (key.return) {
          const r = parseDaysRequested(daysInput);
          if ('error' in r) { setDaysError(r.error); return; }
          const link = links[linkCursor];
          if (!link) { setLinkMode('list'); return; }
          setDaysError('');
          setLinkMode('list');
          setMainView('add-data');
          setAddStep('link-plaid');
          startPlaidLink(r.days, link.item_id);
          return;
        }
        if (key.backspace || key.delete) { setDaysInput((v) => v.slice(0, -1)); setDaysError(''); return; }
        if (input && /[0-9]/.test(input) && !key.ctrl && !key.meta) { setDaysInput((v) => v + input); setDaysError(''); return; }
        return;
      }
      if (key.escape) { setMainView('accounts'); return; }
      if (key.tab) { setMainView('accounts'); return; }
      if (key.upArrow)   { setLinkCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setLinkCursor((c) => Math.min(links.length - 1, c + 1)); return; }
      if (input === 'd' && links[linkCursor]) { setLinkMode('confirm-remove'); return; }
      if (input === 'h' && links[linkCursor]) { setDaysInput('180'); setDaysError(''); setLinkMode('change-history'); return; }
      if (input === 's' && syncStatus === 'idle') { forceSync(); return; }
      return;
    }

    // ── Dupes view ────────────────────────────────────────────────────────────
    if (mainView === 'dupes') {
      if (key.escape) { setMainView('accounts'); return; }
      if (key.tab) { setMainView('plaid-links'); return; }
      if (key.upArrow)   { setDupeCursor((c) => Math.max(0, c - 1)); return; }
      if (key.downArrow) { setDupeCursor((c) => Math.min(dupes.length - 1, c + 1)); return; }
      if (input === 'd' && dupes[dupeCursor]) {
        db.prepare('DELETE FROM transactions WHERE id = ?').run(dupes[dupeCursor].csvId);
        const next = getCsvPlaidDupeCandidates();
        setDupes(next);
        setDupeCursor((c) => Math.min(c, Math.max(0, next.length - 1)));
        return;
      }
      if (input === 'D') {
        const ids = dupes.map((p) => p.csvId);
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`).run(...ids);
        setDupes([]);
        setDupeCursor(0);
        return;
      }
      return;
    }

    // ── Add-data view ──────────────────────────────────────────────────────────
    if (addStep === 'landing') {
      if (key.escape) { setMainView('accounts'); return; }
      if (key.tab) { setMainView('dupes'); return; }
      if (input === 'l') { setDaysInput('180'); setDaysError(''); setAddStep('link-days'); return; }
      if (input === 'c') { setAddStep('file'); return; }
      if (input === 'a') { setCreateName(''); setCreateType('credit'); setCreateSubtype('credit card'); setCreateField('type'); setAddStep('create-acct-name'); return; }
      if (input === 'm') { setManualName(''); setAddStep('manual-name'); return; }
      if (input === 's' && syncStatus === 'idle') { forceSync(); return; }
      return;
    }

    if (addStep === 'link-days') {
      if (key.escape) { setAddStep('landing'); setDaysError(''); return; }
      if (key.return) {
        const r = parseDaysRequested(daysInput);
        if ('error' in r) { setDaysError(r.error); return; }
        setDaysError('');
        setAddStep('link-plaid');
        startPlaidLink(r.days);
        return;
      }
      if (key.backspace || key.delete) { setDaysInput((v) => v.slice(0, -1)); setDaysError(''); return; }
      if (input && /[0-9]/.test(input) && !key.ctrl && !key.meta) { setDaysInput((v) => v + input); setDaysError(''); return; }
      return;
    }

    if (addStep === 'link-plaid') {
      if (key.return && (linkStatus === 'done' || linkStatus === 'error')) {
        setLinkStatus('idle');
        setLinkMsg('');
        setMainView('accounts');
        setAddStep('landing');
      }
      return;
    }

    if (addStep === 'file') {
      if (key.escape) { setAddStep('landing'); return; }
      if (key.return) { tryLoadFile(filePath); return; }
      if (key.backspace || key.delete) { setFilePath((p) => p.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) setFilePath((p) => p + input);
      return;
    }

    if (addStep === 'map-date' || addStep === 'map-name' || addStep === 'map-amount' || addStep === 'map-debit' || addStep === 'map-credit') {
      if (key.escape) { setAddStep('landing'); return; }
      if (key.upArrow) setColCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setColCursor((c) => Math.min(headers.length - 1, c + 1));
      if (key.return) {
        if (addStep === 'map-date')   { setDateCol(colCursor); setColCursor(nameCol ?? 0); setAddStep('map-name'); }
        else if (addStep === 'map-name')   { setNameCol(colCursor); setAddStep('map-amount-mode'); }
        else if (addStep === 'map-amount') { setAmountCol(colCursor); setAddStep('direction'); }
        else if (addStep === 'map-debit')  { setDebitCol(colCursor); setColCursor(0); setAddStep('map-credit'); }
        else if (addStep === 'map-credit') {
          setCreditCol(colCursor);
          const accts = getCsvAccounts(); setCsvAccounts(accts); setAddStep('account');
        }
      }
      return;
    }

    if (addStep === 'map-amount-mode') {
      if (key.escape) { setAddStep('landing'); return; }
      if (input === 's') { setAmountMode('single'); setColCursor(0); setAddStep('map-amount'); }
      if (input === 'd') { setAmountMode('split'); setColCursor(0); setAddStep('map-debit'); }
      return;
    }

    if (addStep === 'direction') {
      if (key.escape) { setAddStep('landing'); return; }
      if (input === 'i') { setPositiveIsInflow(true);  const a = getCsvAccounts(); setCsvAccounts(a); setAddStep('account'); }
      if (input === 'o') { setPositiveIsInflow(false); const a = getCsvAccounts(); setCsvAccounts(a); setAddStep('account'); }
      return;
    }

    if (addStep === 'account') {
      if (key.escape) { setAddStep('landing'); return; }
      if (key.upArrow)   setCsvAccountCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCsvAccountCursor((c) => Math.min(csvAccounts.length - 1, c + 1));
      if (key.return) setAddStep('confirm');
      return;
    }

    if (addStep === 'confirm') {
      if (key.escape) { setAddStep('landing'); return; }
      if (input === 'y') doImport();
      if (input === 'n') { setAddStep('landing'); }
      return;
    }

    if (addStep === 'done') {
      if (key.return) { setImportResult(null); setAddStep('landing'); setMainView('accounts'); loadAccounts(); }
      return;
    }

    if (addStep === 'create-acct-name') {
      if (key.escape) { setAddStep('landing'); return; }
      if (key.return && createName.trim()) { setCreateField('type'); setAddStep('create-acct-type'); return; }
      if (key.backspace || key.delete) { setCreateName((v) => v.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setCreateName((v) => v + input); return; }
      return;
    }

    if (addStep === 'create-acct-type') {
      if (key.escape) { setAddStep('create-acct-name'); return; }
      if (key.return) { saveNewAccount(); return; }
      if (key.tab) {
        setCreateField((f) => f === 'type' ? 'subtype' : 'type');
        return;
      }
      if (createField === 'type' && (key.leftArrow || key.rightArrow)) {
        const idx = ACCOUNT_TYPES.indexOf(createType as typeof ACCOUNT_TYPES[number]);
        const next = ACCOUNT_TYPES[(idx + (key.leftArrow ? -1 : 1) + ACCOUNT_TYPES.length) % ACCOUNT_TYPES.length];
        setCreateType(next);
        setCreateSubtype(SUBTYPES[next]?.[0] ?? '');
        return;
      }
      if (createField === 'subtype') {
        const subtypes = SUBTYPES[createType] ?? [];
        if (subtypes.length > 0 && (key.leftArrow || key.rightArrow)) {
          const idx = subtypes.indexOf(createSubtype);
          setCreateSubtype(subtypes[(idx + (key.leftArrow ? -1 : 1) + subtypes.length) % subtypes.length]);
        }
        return;
      }
      return;
    }

    if (addStep === 'create-acct-done') {
      if (key.return) { setCreateName(''); setAddStep('landing'); setMainView('accounts'); }
      return;
    }

    if (addStep === 'manual-name') {
      if (key.escape) { setAddStep('landing'); setManualName(''); return; }
      if (key.return && manualName.trim()) { setManualValue(''); setManualValueError(''); setAddStep('manual-value'); return; }
      if (key.backspace || key.delete) { setManualName((n) => n.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setManualName((n) => n + input); return; }
      return;
    }

    if (addStep === 'manual-value') {
      if (key.escape) { setAddStep('manual-name'); return; }
      if (key.return) { saveManualAsset(); return; }
      if (key.backspace || key.delete) { setManualValue((v) => v.slice(0, -1)); setManualValueError(''); return; }
      if (input && !key.ctrl && !key.meta) { setManualValue((v) => v + input); setManualValueError(''); return; }
      return;
    }

    if (addStep === 'manual-done') {
      if (key.return) { setManualName(''); setManualValue(''); setAddStep('landing'); setMainView('accounts'); }
      return;
    }
  }, { isActive: isActive !== false });

  // ─── Render ──────────────────────────────────────────────────────────────────

  const selectedAcct = linkedAccounts[acctCursor];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <NavHints current="accounts" showHints={showHints} />
      </Box>

      <Box marginTop={1}>
        <Box gap={3}>
          <Text bold color={mainView === 'accounts' ? 'white' : undefined} dimColor={mainView !== 'accounts'}>Accounts</Text>
          <Text bold color={mainView === 'add-data' ? 'white' : undefined} dimColor={mainView !== 'add-data'}>Add Data</Text>
          <Text bold color={mainView === 'dupes' ? 'white' : undefined} dimColor={mainView !== 'dupes'}>
            Dupes{dupes.length > 0 ? ` (${dupes.length})` : ''}
          </Text>
          <Text bold color={mainView === 'plaid-links' ? 'white' : undefined} dimColor={mainView !== 'plaid-links'}>Plaid Links</Text>
          {showHints && <Text dimColor>[Tab]</Text>}
        </Box>
      </Box>
      {showHints && <Box justifyContent="flex-end">
        <Text dimColor>
          {mainView === 'accounts' && acctMode === 'list'
            ? `↑↓ select  ·  [e] edit  ·  [n] nickname  ·  [o] owner  ·  [t] tag${selectedAcct?.id.startsWith('manual-') ? '  ·  [v] update value' : '  ·  [r] repair link'}  ·  [d] delete  ·  [s] sync`
            : mainView === 'accounts' && acctMode === 'edit'
            ? 'Tab field  ·  ← → value  ·  Enter save  ·  Esc cancel'
            : mainView === 'dupes'
            ? '↑↓ select  ·  [d] delete CSV copy  ·  [D] delete all'
            : mainView === 'plaid-links'
            ? '↑↓ select  ·  [h] change history  ·  [d] remove link  ·  [s] sync'
            : ''}
        </Text>
      </Box>}

      <Box marginTop={1}><Divider /></Box>

      {/* ── Accounts view ─────────────────────────────────────────────── */}
      {mainView === 'accounts' && (
        <>
          {linkedAccounts.length === 0 ? (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>No accounts linked yet.</Text>
              <Text dimColor>Tab → Add Data → [l] link a bank or [c] import CSV.</Text>
            </Box>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {linkedAccounts.map((acct, i) => {
                const isSelected = i === acctCursor;
                const SUBTYPE_DISPLAY: Record<string, string> = { 'crypto exchange': 'crypto' };
                const raw = acct.subtype ?? acct.type;
                const label = (SUBTYPE_DISPLAY[raw] ?? raw).padEnd(14);
                const institution = acct.institution_name ? truncate(acct.institution_name, acctInstW) : '';
                return (
                  <Box key={acct.id} gap={2}>
                    <Text color={isSelected ? 'cyan' : undefined}>
                      {isSelected ? '▶ ' : '  '}
                    </Text>
                    <Text color={isSelected ? 'cyan' : undefined} dimColor={!isSelected}>
                      {truncate(acct.nickname ?? acct.name, acctNameW).padEnd(acctNameW)}
                    </Text>
                    <Text dimColor={!isSelected} color={isSelected && acct.nickname ? 'yellow' : undefined}>{acct.nickname ? '✎' : ' '}</Text>
                    <Text dimColor>{acct.mask ? `···${acct.mask}` : '      '}</Text>
                    <Text dimColor>{label}</Text>
                    <Text dimColor>{institution.padEnd(acctInstW)}</Text>
                    <Text dimColor>
                      {acct.last_synced
                        ? <Text>synced <Text color={isSelected ? 'green' : undefined}>{fmtDate(acct.last_synced)}</Text></Text>
                        : <Text color="yellow">not synced</Text>
                      }
                    </Text>
                    {acct.owner && <Text color={isSelected ? 'magenta' : undefined} dimColor={!isSelected}>{acct.owner}</Text>}
                    {acct.default_tag && <Text color={isSelected ? 'blue' : undefined} dimColor={!isSelected}>#{acct.default_tag}</Text>}
                  </Box>
                );
              })}
            </Box>
          )}

          <Box marginTop={1}><Divider /></Box>
          <Text dimColor>{linkedAccounts.length} account{linkedAccounts.length !== 1 ? 's' : ''}</Text>
          {syncMsg && <Text color={syncStatus === 'syncing' ? 'yellow' : 'green'}>{syncMsg}</Text>}
          {acctMsg && <Text color="green">{acctMsg}</Text>}

          {/* Confirm-delete panel */}
          {acctMode === 'confirm-delete' && selectedAcct && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
              <Text bold color="red">Delete account — this cannot be undone</Text>
              <Box marginTop={1} flexDirection="column">
                <Text><Text color="cyan">{selectedAcct.nickname ?? selectedAcct.name}</Text>  {selectedAcct.mask ? `···${selectedAcct.mask}` : ''}</Text>
                {selectedAcct.id.startsWith('manual-')
                  ? <Text dimColor>Removes this asset and its balance history.</Text>
                  : <Text dimColor>Removes this account, all its transactions, and balance history.</Text>
                }
              </Box>
              <Box marginTop={1} gap={4}>
                <Text color="red">[y] Yes, delete</Text>
                <Text color="green">[n] / Esc cancel</Text>
              </Box>
            </Box>
          )}

          {/* Nickname panel */}
          {acctMode === 'nickname' && selectedAcct && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
              <Text bold>Nickname: {selectedAcct.name}</Text>
              <Text dimColor>Leave empty to clear nickname</Text>
              <Box marginTop={1}>
                <Text>Nickname: </Text>
                <Text color="yellow">{nicknameInput}</Text>
                <Text color="cyan">▊</Text>
              </Box>
              <Box marginTop={1}><Text dimColor>Enter save · Esc cancel</Text></Box>
            </Box>
          )}

          {/* Owner panel */}
          {acctMode === 'owner' && selectedAcct && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="magenta" paddingX={2} paddingY={1}>
              <Text bold>Owner: {selectedAcct.nickname ?? selectedAcct.name}</Text>
              <Text dimColor>Who owns this account? Leave empty to clear.</Text>
              <Box marginTop={1}>
                <Text>Owner: </Text>
                <Text color="magenta">{ownerInput}</Text>
                <Text color="cyan">▊</Text>
              </Box>
              <Box marginTop={1}><Text dimColor>Enter save · Esc cancel</Text></Box>
            </Box>
          )}

          {/* Default-tag panel */}
          {acctMode === 'default-tag' && selectedAcct && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="blue" paddingX={2} paddingY={1}>
              <Text bold>Default tag: {selectedAcct.nickname ?? selectedAcct.name}</Text>
              <Text dimColor>Applied to all of this account's transactions, now and going forward. Leave empty to clear.</Text>
              <Box marginTop={1}>
                <Text>Tag: #</Text>
                <Text color="blue">{tagInput}</Text>
                <Text color="cyan">▊</Text>
              </Box>
              <Box marginTop={1}><Text dimColor>Enter save · Esc cancel</Text></Box>
            </Box>
          )}

          {/* Default-tag create-confirm panel */}
          {acctMode === 'default-tag-confirm' && selectedAcct && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
              <Text bold color="yellow">Tag "{pendingTagName}" doesn't exist</Text>
              <Text dimColor>Create it and apply it to all of {selectedAcct.nickname ?? selectedAcct.name}'s transactions?</Text>
              <Box marginTop={1} gap={4}>
                <Text color="green">[y] Create & apply</Text>
                <Text color="red">[n] / Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Update-value panel */}
          {acctMode === 'update-value' && selectedAcct && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
              <Text bold>Update value: {selectedAcct.name}</Text>
              <Box marginTop={1}>
                <Text>New value: $</Text>
                <Text color="yellow">{updateValueInput}</Text>
                <Text color="cyan">█</Text>
              </Box>
              {updateValueError && <Text color="red">{updateValueError}</Text>}
              <Box marginTop={1}><Text dimColor>Enter save · Esc cancel</Text></Box>
            </Box>
          )}

          {/* Edit panel */}
          {acctMode === 'edit' && selectedAcct && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
              <Text bold>Edit: {selectedAcct.name}{selectedAcct.mask ? ` ···${selectedAcct.mask}` : ''}</Text>
              <Box marginTop={1} flexDirection="column" gap={1}>
                <Box gap={2}>
                  <Text color={editField === 'type' ? 'cyan' : 'white'}>
                    {editField === 'type' ? '▶ ' : '  '}Type
                  </Text>
                  <Text color={editField === 'type' ? 'cyan' : undefined}>
                    {'← '}{editType}{'  →'}
                  </Text>
                </Box>
                <Box gap={2}>
                  <Text color={editField === 'subtype' ? 'cyan' : 'white'}>
                    {editField === 'subtype' ? '▶ ' : '  '}Subtype
                  </Text>
                  <Text color={editField === 'subtype' ? 'cyan' : 'yellow'}>
                    {'← '}{editSubtype || '—'}{'  →'}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}
        </>
      )}

      {/* ── Dupes view ────────────────────────────────────────────────── */}
      {mainView === 'dupes' && (
        <Box flexDirection="column" marginTop={1}>
          {dupes.length === 0 ? (
            <Text color="green">No duplicate candidates found.</Text>
          ) : (
            dupes.map((pair, i) => {
              const isSelected = i === dupeCursor;
              return (
                <Box key={pair.csvId} flexDirection="column" marginBottom={1}>
                  <Box gap={2}>
                    <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '▶' : ' '}</Text>
                    <Text dimColor>{truncate(pair.accountName, 20).padEnd(20)}</Text>
                    <Text color="yellow">CSV</Text>
                    <Text dimColor>{pair.csvDate}</Text>
                    <Text color={isSelected ? 'cyan' : undefined}>{truncate(pair.csvName, 30).padEnd(30)}</Text>
                    <Text color="red">${Math.abs(pair.csvAmount).toFixed(2)}</Text>
                  </Box>
                  <Box gap={2}>
                    <Text> </Text>
                    <Text dimColor>{''.padEnd(20)}</Text>
                    <Text color="green">PLI</Text>
                    <Text dimColor>{pair.plaidDate}</Text>
                    <Text dimColor>{truncate(pair.plaidName, 30)}</Text>
                  </Box>
                </Box>
              );
            })
          )}
        </Box>
      )}

      {/* ── Links view ────────────────────────────────────────────────── */}
      {mainView === 'plaid-links' && (
        <Box flexDirection="column" marginTop={1}>
          {links.length === 0 ? (
            <Text dimColor>No bank links yet. Tab → Add Data → [l] link a bank.</Text>
          ) : (
            links.map((link, i) => {
              const isSelected = i === linkCursor;
              const synced = link.last_synced_at
                ? fmtDate(new Date(link.last_synced_at).toISOString().slice(0, 10))
                : 'never';
              return (
                <Box key={link.item_id} gap={2}>
                  <Text color={isSelected ? 'cyan' : undefined}>{isSelected ? '▶ ' : '  '}</Text>
                  <Text color={isSelected ? 'cyan' : undefined} dimColor={!isSelected}>
                    {truncate(link.institution_name ?? 'Unknown institution', 28).padEnd(28)}
                  </Text>
                  <Text dimColor>{`${link.account_count} acct${link.account_count !== 1 ? 's' : ''}`.padEnd(8)}</Text>
                  <Text dimColor>
                    {link.last_synced_at
                      ? <Text>synced <Text color={isSelected ? 'green' : undefined}>{synced}</Text></Text>
                      : <Text color="yellow">never synced</Text>}
                  </Text>
                  <Text dimColor>{link.days_requested ? `${link.days_requested}d` : '—'}</Text>
                  <Text dimColor>···{link.item_id.slice(-6)}</Text>
                </Box>
              );
            })
          )}

          <Box marginTop={1}><Divider /></Box>
          <Text dimColor>{links.length} link{links.length !== 1 ? 's' : ''}</Text>
          {syncMsg && <Text color={syncStatus === 'syncing' ? 'yellow' : 'green'}>{syncMsg}</Text>}
          {removeMsg && <Text color="green">{removeMsg}</Text>}

          {linkMode === 'change-history' && links[linkCursor] && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
              <Text bold color="yellow">Change history window — {links[linkCursor].institution_name ?? 'Unknown institution'}</Text>
              <Text dimColor>Plaid can't change history on an existing link, so this re-links the bank.</Text>
              <Text dimColor>After the new link succeeds, the current accounts, transactions, balances, and any manual edits are replaced.</Text>
              <Box marginTop={1}>
                <Text>Days (30–730): </Text>
                <Text color="yellow">{daysInput}</Text>
                <Text color="cyan">▊</Text>
              </Box>
              {daysError && <Text color="red">{daysError}</Text>}
              <Box marginTop={1}><Text dimColor>Enter re-link · Esc cancel</Text></Box>
            </Box>
          )}

          {linkMode === 'confirm-remove' && links[linkCursor] && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
              <Text bold color="red">Remove bank link — this cannot be undone</Text>
              <Box marginTop={1} flexDirection="column">
                <Text><Text color="cyan">{links[linkCursor].institution_name ?? 'Unknown institution'}</Text>  <Text dimColor>···{links[linkCursor].item_id.slice(-6)}</Text></Text>
                <Text dimColor>Removes this Plaid connection and all {links[linkCursor].account_count} of its account{links[linkCursor].account_count !== 1 ? 's' : ''}, with their transactions and balance history.</Text>
              </Box>
              <Box marginTop={1} gap={4}>
                <Text color="red">[y] Yes, remove</Text>
                <Text color="green">[n] / Esc cancel</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* ── Add-data view ─────────────────────────────────────────────── */}
      {mainView === 'add-data' && (
        <>
          {addStep === 'landing' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Box flexDirection="column" gap={1} marginTop={1}>
                <Text color="cyan">[l] Link a bank account  <Text dimColor>Opens Plaid in your browser</Text></Text>
                <Text color="cyan">[c] Import CSV file      <Text dimColor>Upload a statement export</Text></Text>
                <Text color="cyan">[a] Create account       <Text dimColor>New account without Plaid</Text></Text>
                <Text color="cyan">[m] Manual asset         <Text dimColor>House, car, or other asset</Text></Text>
                <Text color={syncStatus === 'syncing' ? 'yellow' : 'cyan'}>
                  [s] Force sync          <Text dimColor>Re-sync from Plaid now</Text>
                </Text>
              </Box>
              {syncMsg && <Box marginTop={1}><Text color={syncStatus === 'syncing' ? 'yellow' : 'green'}>{syncMsg}</Text></Box>}
              <Box marginTop={1}><Text dimColor>Tab or Esc to go back</Text></Box>
            </Box>
          )}

          {addStep === 'link-days' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>How much history should Plaid fetch?</Text>
              <Text dimColor>30–730 days (default 180). Can't be changed later without re-linking and loss of any manual edits to transactions.</Text>
              <Box marginTop={1}>
                <Text>Days: </Text>
                <Text color="yellow">{daysInput}</Text>
                <Text color="cyan">▊</Text>
              </Box>
              {daysError && <Text color="red">{daysError}</Text>}
              <Box marginTop={1}><Text dimColor>Enter continue · Esc cancel</Text></Box>
            </Box>
          )}

          {addStep === 'link-plaid' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>Link Bank Account</Text>
              <Text color={linkStatus === 'done' ? 'green' : linkStatus === 'error' ? 'red' : 'yellow'}>
                {linkStatus === 'running' ? '⟳ ' : ''}{linkMsg}
              </Text>
              {linkStatus === 'running' && (
                <Text dimColor>Complete the Plaid flow in your browser, then return here.</Text>
              )}
              {(linkStatus === 'done' || linkStatus === 'error') && (
                <Text dimColor>Press Enter to return.</Text>
              )}
            </Box>
          )}

          {addStep === 'file' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text dimColor>Enter the path to your CSV file:</Text>
              <Box>
                <Text>Path: </Text>
                <Text color="yellow">{filePath}<Text color="cyan">█</Text></Text>
              </Box>
              {fileError && <Text color="red">{fileError}</Text>}
              <Text dimColor>Press Enter to load · Esc back</Text>
            </Box>
          )}

          {(addStep === 'map-date' || addStep === 'map-name' || addStep === 'map-amount' || addStep === 'map-debit' || addStep === 'map-credit') && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>
                {addStep === 'map-date'   && 'Which column is the DATE?'}
                {addStep === 'map-name'   && 'Which column is the DESCRIPTION/NAME?'}
                {addStep === 'map-amount' && 'Which column is the AMOUNT?'}
                {addStep === 'map-debit'  && 'Which column is the DEBIT (money out)?'}
                {addStep === 'map-credit' && 'Which column is the CREDIT (money in)?'}
              </Text>
              <Text dimColor>↑↓ select · Enter confirm · Esc cancel</Text>
              <Box flexDirection="column" marginTop={1}>
                {headers.map((h, i) => {
                  const sample = csvRows.slice(0, 3).map((r) => r[i] ?? '').filter(Boolean).join(', ');
                  return (
                    <Box key={i} gap={2}>
                      <Text color={i === colCursor ? 'cyan' : 'white'} dimColor={i !== colCursor}>
                        {i === colCursor ? '▶ ' : '  '}
                        {h.padEnd(24)}
                        <Text dimColor>  {truncate(sample, 36)}</Text>
                      </Text>
                    </Box>
                  );
                })}
              </Box>
              <Box marginTop={1} gap={3}>
                {dateCol !== null   && <Text dimColor>date: <Text color="green">{headers[dateCol]}</Text></Text>}
                {nameCol !== null   && <Text dimColor>name: <Text color="green">{headers[nameCol]}</Text></Text>}
                {amountCol !== null && <Text dimColor>amount: <Text color="green">{headers[amountCol]}</Text></Text>}
                {debitCol !== null  && <Text dimColor>debit: <Text color="green">{headers[debitCol]}</Text></Text>}
                {creditCol !== null && <Text dimColor>credit: <Text color="green">{headers[creditCol]}</Text></Text>}
              </Box>
            </Box>
          )}

          {addStep === 'map-amount-mode' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>How is the amount structured?</Text>
              <Text color="cyan">[s] Single column  <Text dimColor>(one column, positive or negative)</Text></Text>
              <Text color="cyan">[d] Debit / Credit  <Text dimColor>(two separate columns)</Text></Text>
            </Box>
          )}

          {addStep === 'direction' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>In column <Text color="yellow">"{headers[amountCol!]}"</Text>, does a positive number mean...</Text>
              <Text color="cyan">[i] Inflow  <Text dimColor>(money coming in)</Text></Text>
              <Text color="cyan">[o] Outflow <Text dimColor>(money going out)</Text></Text>
            </Box>
          )}

          {addStep === 'account' && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Which account do these transactions belong to?</Text>
              <Text dimColor>↑↓ select · Enter confirm</Text>
              <Box flexDirection="column" marginTop={1}>
                {csvAccounts.map((acct, i) => (
                  <Box key={acct.id} gap={2}>
                    <Text color={i === csvAccountCursor ? 'cyan' : 'white'} dimColor={i !== csvAccountCursor}>
                      {i === csvAccountCursor ? '▶ ' : '  '}{acct.name}
                      <Text dimColor>  {acct.mask ? `···${acct.mask}` : ''}</Text>
                    </Text>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {addStep === 'confirm' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>Ready to import</Text>
              <Text>File: <Text color="yellow">{filePath}</Text></Text>
              <Text>Account: <Text color="cyan">{csvAccounts[csvAccountCursor]?.name}</Text></Text>
              <Text>{csvRows.length} rows · sample preview:</Text>
              <Box flexDirection="column" marginTop={1}>
                <Box gap={2}>
                  <Text dimColor>{'DATE'.padEnd(12)}</Text>
                  <Text dimColor>{'DESCRIPTION'.padEnd(30)}</Text>
                  <Text dimColor>AMOUNT</Text>
                </Box>
                {csvRows.slice(0, 5).map((row, i) => {
                  const { date, name, amount } = previewRow(row);
                  return (
                    <Box key={i} gap={2}>
                      <Text>{date.padEnd(12)}</Text>
                      <Text>{name.padEnd(30)}</Text>
                      <Text color="yellow">{amount}</Text>
                    </Box>
                  );
                })}
              </Box>
              <Box marginTop={1} gap={4}>
                <Text color="cyan">[y] Import</Text>
                <Text color="red">[n] Cancel</Text>
              </Box>
            </Box>
          )}

          {addStep === 'done' && importResult && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold color="green">Import complete</Text>
              <Text>Imported: <Text color="green">{importResult.imported}</Text></Text>
              <Text dimColor>Skipped (duplicates/invalid): {importResult.skipped}</Text>
              <Box marginTop={1}><Text dimColor>Press Enter to return</Text></Box>
            </Box>
          )}

          {addStep === 'create-acct-name' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>Create Account — Name</Text>
              <Text dimColor>Type a name for this account (e.g. "Venture X", "Freedom Unlimited")</Text>
              <Box marginTop={1}>
                <Text>Name: </Text>
                <Text color="yellow">{createName}</Text>
                <Text color="cyan">█</Text>
              </Box>
              <Text dimColor>Enter to continue · Esc cancel</Text>
            </Box>
          )}

          {addStep === 'create-acct-type' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>Create Account — Type</Text>
              <Text dimColor>Account: <Text color="cyan">{createName}</Text></Text>
              <Box flexDirection="column" marginTop={1} gap={1}>
                <Box gap={2}>
                  <Text color={createField === 'type' ? 'cyan' : 'white'}>
                    {createField === 'type' ? '▶ ' : '  '}Type
                  </Text>
                  <Text color={createField === 'type' ? 'cyan' : undefined}>
                    {'← '}{createType}{'  →'}
                  </Text>
                </Box>
                <Box gap={2}>
                  <Text color={createField === 'subtype' ? 'cyan' : 'white'}>
                    {createField === 'subtype' ? '▶ ' : '  '}Subtype
                  </Text>
                  <Text color={createField === 'subtype' ? 'cyan' : 'yellow'}>
                    {'← '}{createSubtype || '—'}{'  →'}
                  </Text>
                </Box>
              </Box>
              <Text dimColor>Tab switch field · ← → change · Enter save · Esc back</Text>
            </Box>
          )}

          {addStep === 'create-acct-done' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold color="green">Account created</Text>
              <Text><Text color="cyan">{createName}</Text> added as <Text color="yellow">{createType} / {createSubtype}</Text>.</Text>
              <Text dimColor>Import transactions via Add Data → [c] Import CSV.</Text>
              <Box marginTop={1}><Text dimColor>Press Enter to return</Text></Box>
            </Box>
          )}

          {addStep === 'manual-name' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>Manual Asset — Name</Text>
              <Text dimColor>Type a name for this asset (e.g. "House", "Car")</Text>
              <Box marginTop={1}>
                <Text>Name: </Text>
                <Text color="yellow">{manualName}</Text>
                <Text color="cyan">█</Text>
              </Box>
              <Text dimColor>Enter to continue · Esc cancel</Text>
            </Box>
          )}

          {addStep === 'manual-value' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold>Manual Asset — Current Value</Text>
              <Text dimColor>Asset: <Text color="cyan">{manualName}</Text></Text>
              <Box marginTop={1}>
                <Text>Value: $</Text>
                <Text color="yellow">{manualValue}</Text>
                <Text color="cyan">█</Text>
              </Box>
              {manualValueError && <Text color="red">{manualValueError}</Text>}
              <Text dimColor>Enter to save · Esc back</Text>
            </Box>
          )}

          {addStep === 'manual-done' && (
            <Box flexDirection="column" marginTop={1} gap={1}>
              <Text bold color="green">Asset added</Text>
              <Text><Text color="cyan">{manualName}</Text> added to your accounts.</Text>
              <Text dimColor>Update its value anytime from the Accounts tab with [v].</Text>
              <Box marginTop={1}><Text dimColor>Press Enter to return</Text></Box>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
