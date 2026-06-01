import { describe, it, expect } from 'vitest';
import { daysFromStartDate, MIN_DAYS_REQUESTED, MAX_DAYS_REQUESTED, START_DATE_BUFFER_DAYS } from '../core/settings.js';

// Fixed "today" for deterministic day-count math
const today = new Date(2026, 4, 31, 12, 0, 0); // 2026-05-31

describe('daysFromStartDate', () => {
  it('counts whole days between the start date and today, plus the buffer', () => {
    expect(daysFromStartDate('2026-05-01', today)).toBe(30 + START_DATE_BUFFER_DAYS);
    expect(daysFromStartDate('2026-01-31', today)).toBe(120 + START_DATE_BUFFER_DAYS);
  });

  it('clamps to the maximum when the start date is more than 730 days ago', () => {
    expect(daysFromStartDate('2020-01-01', today)).toBe(MAX_DAYS_REQUESTED);
  });

  it('clamps to the minimum when the start date is very recent', () => {
    expect(daysFromStartDate('2026-05-30', today)).toBe(MIN_DAYS_REQUESTED);
    expect(daysFromStartDate('2026-05-31', today)).toBe(MIN_DAYS_REQUESTED);
  });

  it('returns null for malformed dates', () => {
    expect(daysFromStartDate('not-a-date', today)).toBeNull();
    expect(daysFromStartDate('05/31/2026', today)).toBeNull();
    expect(daysFromStartDate('', today)).toBeNull();
  });
});
