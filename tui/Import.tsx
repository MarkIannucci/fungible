import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { db } from '../core/db.js';
import { categorize } from '../core/categorize.js';
import { syncAll } from '../core/sync.js';
import type { Screen, TxFilter } from './App.js';

type Step =
  | 'landing'
  | 'link-plaid'
  | 'file'
  | 'map-date'
  | 'map-name'
  | 'map-amount-mode'  // single col vs debit+credit cols
  | 'map-amount'
  | 'map-debit'
  | 'map-credit'
  | 'direction'       // for single-col: does positive mean inflow or outflow?
  | 'account'
  | 'confirm'
  | 'done';

type Account = { id: string; name: string; mask: string | null };

function parseCSV(filePath: string): { headers: string[]; rows: string[][] } {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  const lines = text.split('\n');
  const parse = (line: string) =>
    line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g)?.map((v) => v.replace(/^"|"$/g, '').trim()) ?? [];
  const headers = parse(lines[0]);
  const rows = lines.slice(1).filter(Boolean).map(parse);
  return { headers, rows };
}

function txId(mask: string, date: string, name: string, amount: number) {
  return 'csv-' + crypto.createHash('sha1')
    .update(`${mask}|${date}|${name.trim().toLowerCase()}|${amount}`)
    .digest('hex').slice(0, 16);
}

function parseDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
    const [m, d, y] = raw.split('/');
    const fullYear = y.length === 2 ? (parseInt(y) < 50 ? `20${y}` : `19${y}`) : y;
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return raw;
}

function getAccounts(): Account[] {
  return db.prepare('SELECT id, name, mask FROM accounts').all() as Account[];
}

function Divider() { return <Text dimColor>{'─'.repeat(70)}</Text>; }
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

export function Import({ onNavigate }: { onNavigate: (s: Screen, f?: TxFilter) => void }) {
  const [step, setStep] = useState<Step>('landing');
  const [linkStatus, setLinkStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [linkMsg, setLinkMsg] = useState('');
  const [filePath, setFilePath] = useState('');
  const [fileError, setFileError] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);

  const [colCursor, setColCursor] = useState(0);
  const [dateCol, setDateCol] = useState<number | null>(null);
  const [nameCol, setNameCol] = useState<number | null>(null);
  const [amountMode, setAmountMode] = useState<'single' | 'split'>('single');
  const [amountCol, setAmountCol] = useState<number | null>(null);
  const [debitCol, setDebitCol] = useState<number | null>(null);
  const [creditCol, setCreditCol] = useState<number | null>(null);
  const [positiveIsInflow, setPositiveIsInflow] = useState(false); // positive = outflow by default

  const [accountCursor, setAccountCursor] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done'>('idle');
  const [syncMsg, setSyncMsg] = useState('');

  function tryLoadFile(path: string) {
    try {
      const parsed = parseCSV(path.trim());
      if (!parsed.headers.length) { setFileError('No columns found'); return; }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setFileError('');
      // Auto-detect common column names
      const h = parsed.headers.map((h) => h.toLowerCase());
      const dateGuess = h.findIndex((x) => x.includes('date') || x.includes('posted'));
      const nameGuess = h.findIndex((x) => x.includes('desc') || x.includes('name') || x.includes('merchant'));
      if (dateGuess >= 0) setDateCol(dateGuess);
      if (nameGuess >= 0) setNameCol(nameGuess);
      setColCursor(0);
      setStep('map-date');
    } catch (e: any) {
      setFileError(e.message);
    }
  }

  function doImport() {
    const acct = accounts[accountCursor];
    const insert = db.prepare(`
      INSERT OR IGNORE INTO transactions (id, account_id, date, name, amount, category, raw_category, pending)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 0)
    `);
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const rawDate = row[dateCol!] ?? '';
      const name = row[nameCol!] ?? '';
      let amount: number;

      if (amountMode === 'split') {
        const debit = parseFloat(row[debitCol!] || '0') || 0;
        const credit = parseFloat(row[creditCol!] || '0') || 0;
        amount = debit > 0 ? debit : -credit;
      } else {
        const raw = parseFloat(row[amountCol!] || '0') || 0;
        // positiveIsInflow = true means positive → negative in Plaid convention
        amount = positiveIsInflow ? -raw : raw;
      }

      if (!rawDate || !name || isNaN(amount)) { skipped++; continue; }

      const date = parseDate(rawDate);
      const category = categorize(name, null, null);
      const id = txId(acct.mask ?? acct.id, date, name, amount);
      const changes = (insert.run(id, acct.id, date, name, amount, category) as any).changes;
      if (changes > 0) imported++; else skipped++;
    }

    setResult({ imported, skipped });
    setStep('done');
  }

  function startPlaidLink() {
    setLinkStatus('running');
    setLinkMsg('Opening browser...');

    const node = process.execPath;
    const script = new URL('../scripts/link.ts', import.meta.url).pathname;
    const child = spawn(node, [
      '--experimental-sqlite', '--no-warnings',
      '--import', 'tsx/esm',
      script,
    ], { cwd: new URL('..', import.meta.url).pathname });

    child.stdout.on('data', (data: Buffer) => {
      const line = data.toString().trim().split('\n').pop() ?? '';
      if (line) setLinkMsg(line);
    });
    child.stderr.on('data', (data: Buffer) => {
      setLinkStatus('error');
      setLinkMsg(data.toString().trim());
    });
    child.on('close', (code: number) => {
      if (code === 0) {
        setLinkStatus('done');
        setLinkMsg('Bank connected! Press Enter to return.');
      } else if (code !== null) {
        setLinkStatus('error');
        setLinkMsg(`Process exited with code ${code}. Press Enter to return.`);
      }
    });
  }

  useInput((input, key) => {
    if (step === 'landing') {
      if (key.escape || input === '1') { onNavigate('dashboard'); return; }
      if (input === '2') { onNavigate('transactions'); return; }
      if (input === '3') { onNavigate('trends'); return; }
      if (input === '4') { onNavigate('networth'); return; }
      if (input === '5') { onNavigate('tags'); return; }
      if (input === '6') { onNavigate('rules'); return; }
      if (input === 'l') { setStep('link-plaid'); startPlaidLink(); return; }
      if (input === 'c') { setStep('file'); return; }
      if (input === 's' && syncStatus === 'idle') {
        setSyncStatus('syncing');
        setSyncMsg('Syncing...');
        syncAll(true).then((results) => {
          const added = results.reduce((s, r) => s + r.added, 0);
          setSyncMsg(`Done — ${added} new transaction${added !== 1 ? 's' : ''}`);
          setSyncStatus('done');
          setTimeout(() => { setSyncStatus('idle'); setSyncMsg(''); }, 4000);
        }).catch(() => {
          setSyncMsg('Sync failed');
          setSyncStatus('done');
          setTimeout(() => { setSyncStatus('idle'); setSyncMsg(''); }, 3000);
        });
        return;
      }
    }

    if (step === 'link-plaid') {
      if (key.return && (linkStatus === 'done' || linkStatus === 'error')) {
        onNavigate('dashboard');
      }
      return;
    }

    if (step === 'file') {
      if (key.escape) { setStep('landing'); return; }
      if (input === '1') { onNavigate('dashboard'); return; }
      if (input === '2') { onNavigate('transactions'); return; }
      if (input === '3') { onNavigate('trends'); return; }
      if (input === '4') { onNavigate('networth'); return; }
      if (input === '5') { onNavigate('tags'); return; }
      if (input === '6') { onNavigate('rules'); return; }
      if (key.return) { tryLoadFile(filePath); return; }
      if (key.backspace || key.delete) { setFilePath((p) => p.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) setFilePath((p) => p + input);
    }

    if (step === 'map-date' || step === 'map-name' || step === 'map-amount' || step === 'map-debit' || step === 'map-credit') {
      if (key.escape) { onNavigate('dashboard'); return; }
      if (key.upArrow) setColCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setColCursor((c) => Math.min(headers.length - 1, c + 1));
      if (key.return) {
        if (step === 'map-date') { setDateCol(colCursor); setColCursor(nameCol ?? 0); setStep('map-name'); }
        else if (step === 'map-name') { setNameCol(colCursor); setStep('map-amount-mode'); }
        else if (step === 'map-amount') { setAmountCol(colCursor); setStep('direction'); }
        else if (step === 'map-debit') { setDebitCol(colCursor); setColCursor(0); setStep('map-credit'); }
        else if (step === 'map-credit') {
          setCreditCol(colCursor);
          const accts = getAccounts(); setAccounts(accts); setStep('account');
        }
      }
    }

    if (step === 'map-amount-mode') {
      if (key.escape) { onNavigate('dashboard'); return; }
      if (input === 's') { setAmountMode('single'); setColCursor(0); setStep('map-amount'); }
      if (input === 'd') { setAmountMode('split'); setColCursor(0); setStep('map-debit'); }
    }

    if (step === 'direction') {
      if (key.escape) { onNavigate('dashboard'); return; }
      if (input === 'i') {
        setPositiveIsInflow(true);
        const accts = getAccounts(); setAccounts(accts); setStep('account');
      }
      if (input === 'o') {
        setPositiveIsInflow(false);
        const accts = getAccounts(); setAccounts(accts); setStep('account');
      }
    }

    if (step === 'account') {
      if (key.escape) { onNavigate('dashboard'); return; }
      if (key.upArrow) setAccountCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setAccountCursor((c) => Math.min(accounts.length - 1, c + 1));
      if (key.return) setStep('confirm');
    }

    if (step === 'confirm') {
      if (key.escape) { onNavigate('dashboard'); return; }
      if (input === 'y') doImport();
      if (input === 'n') onNavigate('dashboard');
    }

    if (step === 'done') {
      if (key.return || input === 'q') onNavigate('dashboard');
    }
  });

  // Build a preview row using current mappings
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

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">fungible</Text>
        <Text dimColor>[1] dash  [2] txns  [3] trends  [4] worth  [5] tags  [6] rules</Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1} marginBottom={1}>
        <Text bold>{step === 'link-plaid' ? 'Link Bank' : step === 'landing' ? 'Add Data' : 'Import CSV'}</Text>
        <Text dimColor>Esc back</Text>
      </Box>
      <Divider />

      {/* Step: landing */}
      {step === 'landing' && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>What would you like to do?</Text>
          <Box marginTop={1} flexDirection="column" gap={1}>
            <Text color="cyan">[l] Link a bank account  <Text dimColor>Opens Plaid in your browser</Text></Text>
            <Text color="cyan">[c] Import CSV file      <Text dimColor>Upload a statement export</Text></Text>
            <Text color={syncStatus === 'syncing' ? 'yellow' : 'cyan'}>
              [s] Force sync          <Text dimColor>Re-sync from Plaid now (ignores 15-min cooldown)</Text>
            </Text>
          </Box>
          {syncMsg && <Box marginTop={1}><Text color={syncStatus === 'syncing' ? 'yellow' : 'green'}>{syncMsg}</Text></Box>}
          <Box marginTop={1}><Text dimColor>Esc to go back</Text></Box>
        </Box>
      )}

      {/* Step: link-plaid */}
      {step === 'link-plaid' && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>Link Bank Account</Text>
          <Text
            color={linkStatus === 'done' ? 'green' : linkStatus === 'error' ? 'red' : 'yellow'}
          >
            {linkStatus === 'running' ? '⟳ ' : ''}{linkMsg}
          </Text>
          {linkStatus === 'running' && (
            <Text dimColor>Complete the Plaid flow in your browser, then return here.</Text>
          )}
          {(linkStatus === 'done' || linkStatus === 'error') && (
            <Text dimColor>Press Enter to return to dashboard.</Text>
          )}
        </Box>
      )}

      {/* Step: file */}
      {step === 'file' && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text dimColor>Enter the path to your CSV file:</Text>
          <Box>
            <Text>Path: </Text>
            <Text color="yellow">{filePath}<Text color="cyan">█</Text></Text>
          </Box>
          {fileError && <Text color="red">{fileError}</Text>}
          <Text dimColor>Press Enter to load</Text>
        </Box>
      )}

      {/* Column selector (shared across map-* steps) */}
      {(step === 'map-date' || step === 'map-name' || step === 'map-amount' || step === 'map-debit' || step === 'map-credit') && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            {step === 'map-date'   && 'Which column is the DATE?'}
            {step === 'map-name'   && 'Which column is the DESCRIPTION/NAME?'}
            {step === 'map-amount' && 'Which column is the AMOUNT?'}
            {step === 'map-debit'  && 'Which column is the DEBIT (money out)?'}
            {step === 'map-credit' && 'Which column is the CREDIT (money in)?'}
          </Text>
          <Text dimColor>↑↓ select · Enter confirm · Esc cancel</Text>
          <Box flexDirection="column" marginTop={1}>
            {headers.map((h, i) => {
              const sample = rows.slice(0, 3).map((r) => r[i] ?? '').filter(Boolean).join(', ');
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

      {/* Step: amount mode */}
      {step === 'map-amount-mode' && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>How is the amount structured?</Text>
          <Text color="cyan">[s] Single column  <Text dimColor>(one column, positive or negative)</Text></Text>
          <Text color="cyan">[d] Debit / Credit  <Text dimColor>(two separate columns)</Text></Text>
        </Box>
      )}

      {/* Step: direction */}
      {step === 'direction' && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>In column <Text color="yellow">"{headers[amountCol!]}"</Text>, does a positive number mean...</Text>
          <Text color="cyan">[i] Inflow  <Text dimColor>(money coming in, e.g. salary, refund)</Text></Text>
          <Text color="cyan">[o] Outflow <Text dimColor>(money going out, e.g. purchase)</Text></Text>
        </Box>
      )}

      {/* Step: account */}
      {step === 'account' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Which account do these transactions belong to?</Text>
          <Text dimColor>↑↓ select · Enter confirm</Text>
          <Box flexDirection="column" marginTop={1}>
            {accounts.map((acct, i) => (
              <Box key={acct.id} gap={2}>
                <Text color={i === accountCursor ? 'cyan' : 'white'} dimColor={i !== accountCursor}>
                  {i === accountCursor ? '▶ ' : '  '}{acct.name}
                  <Text dimColor>  {acct.mask ? `···${acct.mask}` : ''}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Step: confirm */}
      {step === 'confirm' && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold>Ready to import</Text>
          <Text>File: <Text color="yellow">{filePath}</Text></Text>
          <Text>Account: <Text color="cyan">{accounts[accountCursor]?.name}</Text></Text>
          <Text>{rows.length} rows · sample preview:</Text>
          <Box flexDirection="column" marginTop={1}>
            <Box gap={2}>
              <Text dimColor>{'DATE      '.padEnd(12)}</Text>
              <Text dimColor>{'DESCRIPTION'.padEnd(30)}</Text>
              <Text dimColor>AMOUNT</Text>
            </Box>
            {rows.slice(0, 5).map((row, i) => {
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

      {/* Step: done */}
      {step === 'done' && result && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text bold color="green">Import complete</Text>
          <Text>Imported: <Text color="green">{result.imported}</Text></Text>
          <Text dimColor>Skipped (duplicates/invalid): {result.skipped}</Text>
          <Box marginTop={1}><Text dimColor>Press Enter to return to dashboard</Text></Box>
        </Box>
      )}
    </Box>
  );
}
