import { describe, it, expect } from 'vitest';
import { parseDate, parseCurrencyAmount, generateTxId } from '../core/csv.js';

describe('parseDate', () => {
  it('passes through YYYY-MM-DD format unchanged', () => {
    expect(parseDate('2024-03-15')).toBe('2024-03-15');
  });

  it('converts M/D/YY format with year < 50', () => {
    expect(parseDate('3/15/24')).toBe('2024-03-15');
  });

  it('converts M/D/YY format with year >= 50 to 1900s', () => {
    expect(parseDate('3/15/99')).toBe('1999-03-15');
  });

  it('converts M/D/YYYY format', () => {
    expect(parseDate('3/15/2024')).toBe('2024-03-15');
  });

  it('pads single-digit month and day', () => {
    expect(parseDate('1/5/2023')).toBe('2023-01-05');
  });

  it('returns raw string for unrecognized format', () => {
    expect(parseDate('15 March 2024')).toBe('15 March 2024');
  });
});

describe('parseCurrencyAmount', () => {
  it('parses plain number', () => {
    expect(parseCurrencyAmount('100.00')).toBeCloseTo(100);
  });

  it('strips dollar sign', () => {
    expect(parseCurrencyAmount('$50.25')).toBeCloseTo(50.25);
  });

  it('strips commas', () => {
    expect(parseCurrencyAmount('$1,234.56')).toBeCloseTo(1234.56);
  });

  it('parses negative with minus sign', () => {
    expect(parseCurrencyAmount('-75.00')).toBeCloseTo(-75);
  });

  it('parses negative in parentheses notation', () => {
    expect(parseCurrencyAmount('(100.00)')).toBeCloseTo(-100);
  });

  it('handles parentheses with dollar sign', () => {
    expect(parseCurrencyAmount('($200.00)')).toBeCloseTo(-200);
  });
});

describe('generateTxId', () => {
  it('returns a string starting with csv-', () => {
    const id = generateTxId('1234', '2024-01-15', 'AMAZON', 99.99);
    expect(id).toMatch(/^csv-[0-9a-f]{16}$/);
  });

  it('is deterministic — same inputs produce same output', () => {
    const a = generateTxId('1234', '2024-01-15', 'AMAZON', 99.99);
    const b = generateTxId('1234', '2024-01-15', 'AMAZON', 99.99);
    expect(a).toBe(b);
  });

  it('different inputs produce different output', () => {
    const a = generateTxId('1234', '2024-01-15', 'AMAZON', 99.99);
    const b = generateTxId('1234', '2024-01-15', 'AMAZON', 50.00);
    expect(a).not.toBe(b);
  });

  it('is case-insensitive for name', () => {
    const a = generateTxId('1234', '2024-01-15', 'amazon', 99.99);
    const b = generateTxId('1234', '2024-01-15', 'AMAZON', 99.99);
    expect(a).toBe(b);
  });

  it('trims whitespace from name', () => {
    const a = generateTxId('1234', '2024-01-15', '  amazon  ', 99.99);
    const b = generateTxId('1234', '2024-01-15', 'amazon', 99.99);
    expect(a).toBe(b);
  });
});
