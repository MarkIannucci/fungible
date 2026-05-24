/**
 * Navigation consistency test
 *
 * Screens are numbered:
 *   1=dashboard  2=transactions  3=trends  4=networth  5=tags  6=health  7=rules  8=accounts
 *
 * Each screen must:
 *   1. Display a nav bar that shows [N] labels for every screen EXCEPT itself
 *   2. Handle every key 1–8 EXCEPT its own, navigating to the correct screen
 *
 * This test parses the TSX source files to verify both invariants.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TUI_DIR = join(__dirname, '..', 'tui');

const KEY_TO_SCREEN: Record<string, string> = {
  '1': 'dashboard',
  '2': 'transactions',
  '3': 'trends',
  '4': 'networth',
  '5': 'tags',
  '6': 'health',
  '7': 'rules',
  '8': 'accounts',
};

const SCREENS = [
  { file: 'Dashboard.tsx',    screen: 'dashboard',    key: '1' },
  { file: 'Transactions.tsx', screen: 'transactions', key: '2' },
  { file: 'Trends.tsx',       screen: 'trends',       key: '3' },
  { file: 'NetWorth.tsx',     screen: 'networth',     key: '4' },
  { file: 'Tags.tsx',         screen: 'tags',         key: '5' },
  { file: 'Health.tsx',       screen: 'health',       key: '6' },
  { file: 'Rules.tsx',        screen: 'rules',        key: '7' },
  { file: 'Accounts.tsx',     screen: 'accounts',     key: '8' },
];

/** Extract all [N] keys present in the primary nav bar text of a source file.
 *  The primary nav bar is the line that lists multiple [N] shortcut labels for
 *  navigating to OTHER screens. We find the line containing the most [N] tokens. */
function extractNavBarKeys(src: string): string[] {
  // Find lines that look like nav bar hints: contain at least two [N] patterns
  const lines = src.split('\n');
  let bestLine = '';
  let bestCount = 0;
  for (const line of lines) {
    const matches = line.match(/\[([1-8])\]/g) ?? [];
    if (matches.length > bestCount) {
      bestCount = matches.length;
      bestLine = line;
    }
  }
  const keys = (bestLine.match(/\[([1-8])\]/g) ?? []).map((m) => m[1]);
  return [...new Set(keys)]; // deduplicate
}

/** Extract input handler mappings: { key -> screen } from `input === 'N'` guards
 *  followed by `onNavigate('screenName')` in the same file. */
function extractInputHandlers(src: string): Record<string, string> {
  const handlers: Record<string, string> = {};
  // Match: input === 'N' ... onNavigate('screen')
  // We use a simple regex that captures the key and destination on the same line,
  // or within a short window.
  const linePattern = /input === '([1-8])'[^)]*onNavigate\('([a-z]+)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = linePattern.exec(src)) !== null) {
    handlers[m[1]] = m[2];
  }

  // Also handle multi-token patterns where onNavigate is on the same logical block.
  // We do a second pass for cases like:
  //   if (input === '2') { onNavigate('transactions'); return; }
  // which the above regex handles. But also:
  //   if (input === '2') onNavigate('transactions');
  const shortPattern = /if\s*\(input === '([1-8])'\)\s*\{?\s*onNavigate\('([a-z]+)'\)/g;
  while ((m = shortPattern.exec(src)) !== null) {
    handlers[m[1]] = m[2];
  }

  return handlers;
}

describe('navigation consistency', () => {
  for (const { file, screen, key } of SCREENS) {
    describe(file, () => {
      const src = readFileSync(join(TUI_DIR, file), 'utf-8');
      const expectedKeys = Object.keys(KEY_TO_SCREEN).filter((k) => k !== key).sort();

      test('nav bar shows all other screens', () => {
        const navBarKeys = extractNavBarKeys(src).sort();
        expect(navBarKeys).toEqual(expectedKeys);
      });

      test('input handlers cover all other screens', () => {
        const handlers = extractInputHandlers(src);
        const handledKeys = Object.keys(handlers).filter((k) => k !== key).sort();
        expect(handledKeys).toEqual(expectedKeys);
      });

      test('input handlers navigate to correct screens', () => {
        const handlers = extractInputHandlers(src);
        for (const [k, dest] of Object.entries(handlers)) {
          if (k === key) continue; // own key is a no-op or escape, skip
          expect(dest).toBe(KEY_TO_SCREEN[k]);
        }
      });

      test(`does not navigate to self via number key`, () => {
        const handlers = extractInputHandlers(src);
        // If the screen handles its own key, it should NOT navigate to a different screen
        if (handlers[key]) {
          expect(handlers[key]).toBe(screen);
        }
      });
    });
  }
});
