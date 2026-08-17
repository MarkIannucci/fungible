import { describe, it, expect, vi, afterAll } from 'vitest';

const { TEST_DATA_DIR } = vi.hoisted(() => {
  const os = require('os') as typeof import('os');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = path.join(os.tmpdir(), `fungible-plaid-diff-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return { TEST_DATA_DIR: dir };
});

// The script imports core/db.js, which creates its client under DATA_DIR at
// module load. Point that at a temp dir so importing it never touches ~/.fungible.
vi.mock('../core/paths.js', () => ({ DATA_DIR: TEST_DATA_DIR }));

import { parseSelection, csvCell } from '../scripts/plaid-diff.js';

afterAll(() => {
  const fs = require('fs') as typeof import('fs');
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const MULTI = { multi: true, defaultAll: true };
const SINGLE = { multi: false, defaultAll: false };

describe('parseSelection', () => {
  it('parses a single number', () => {
    expect(parseSelection('2', 4, SINGLE)).toEqual({ indices: [1] });
  });

  it('parses comma- and space-separated numbers in multi mode', () => {
    expect(parseSelection('1,3', 4, MULTI)).toEqual({ indices: [0, 2] });
    expect(parseSelection('1 3', 4, MULTI)).toEqual({ indices: [0, 2] });
    expect(parseSelection('1, 3 4', 4, MULTI)).toEqual({ indices: [0, 2, 3] });
  });

  it('treats empty input as "all" only when defaultAll is set', () => {
    expect(parseSelection('', 3, MULTI)).toEqual({ indices: [0, 1, 2] });
    expect(parseSelection('   ', 3, MULTI)).toEqual({ indices: [0, 1, 2] });
    expect(parseSelection('', 3, { multi: true, defaultAll: false })).toEqual({
      error: 'Enter at least one number.',
    });
    expect(parseSelection('', 3, SINGLE)).toEqual({ error: 'Enter a number.' });
  });

  it('accepts "a" and "all" in multi mode, case-insensitively', () => {
    for (const answer of ['a', 'A', 'all', 'ALL']) {
      expect(parseSelection(answer, 2, MULTI)).toEqual({ indices: [0, 1] });
    }
  });

  it('does not treat "all" as a keyword in single mode', () => {
    expect(parseSelection('all', 3, SINGLE)).toEqual({
      error: '"all" is not a number between 1 and 3.',
    });
  });

  it('rejects more than one number in single mode', () => {
    expect(parseSelection('1 2', 3, SINGLE)).toEqual({ error: 'Enter a single number.' });
  });

  it('rejects out-of-range, zero, negative, and non-integer input', () => {
    expect(parseSelection('0', 3, MULTI)).toEqual({ error: '"0" is not a number between 1 and 3.' });
    expect(parseSelection('4', 3, MULTI)).toEqual({ error: '"4" is not a number between 1 and 3.' });
    expect(parseSelection('-1', 3, MULTI)).toEqual({ error: '"-1" is not a number between 1 and 3.' });
    expect(parseSelection('1.5', 3, MULTI)).toEqual({ error: '"1.5" is not a number between 1 and 3.' });
    expect(parseSelection('two', 3, MULTI)).toEqual({ error: '"two" is not a number between 1 and 3.' });
  });

  it('reports the first bad token even when valid ones precede it', () => {
    expect(parseSelection('1,9', 3, MULTI)).toEqual({ error: '"9" is not a number between 1 and 3.' });
  });

  it('collapses duplicates while preserving the order they were typed', () => {
    expect(parseSelection('3,1,3', 3, MULTI)).toEqual({ indices: [2, 0] });
  });
});

describe('csvCell', () => {
  it('leaves ordinary values unquoted', () => {
    expect(csvCell('Starbucks')).toBe('Starbucks');
    expect(csvCell(4.5)).toBe('4.5');
    expect(csvCell(false)).toBe('false');
    expect(csvCell(0)).toBe('0');
  });

  it('renders null and undefined as an empty field', () => {
    // Plaid leaves merchant_name, authorized_date and check_number null on most
    // rows; they must not become the strings "null"/"undefined" in the file.
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes values containing a comma — merchant names do this routinely', () => {
    expect(csvCell('SQ *COFFEE, INC')).toBe('"SQ *COFFEE, INC"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('THE "REAL" DEAL')).toBe('"THE ""REAL"" DEAL"');
  });

  it('quotes values containing newlines or carriage returns', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('does not quote a bare apostrophe or spaces', () => {
    expect(csvCell("Trader Joe's")).toBe("Trader Joe's");
  });
});
