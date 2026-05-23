import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../core/db.js', async () => {
  const { makeTestDb } = await import('./helpers/makeTestDb.js');
  return { db: makeTestDb() };
});

import { db } from '../core/db.js';
import { categorize } from '../core/categorize.js';

const insertRule = db.prepare(
  'INSERT INTO category_rules (priority, match_type, pattern, category, min_amount, max_amount) VALUES (?, ?, ?, ?, ?, ?)'
);

beforeEach(() => {
  db.exec('DELETE FROM category_rules');
});

describe('Plaid category fallback', () => {
  it('returns Uncategorized when no rules and no Plaid category', () => {
    expect(categorize('some purchase', null, null)).toBe('Uncategorized');
  });

  it('returns Uncategorized for unknown Plaid category', () => {
    expect(categorize('some purchase', null, 'UNKNOWN_CATEGORY')).toBe('Uncategorized');
  });

  it('maps known Plaid API categories', () => {
    expect(categorize('deposit', null, 'INCOME')).toBe('Income');
    expect(categorize('coffee', null, 'FOOD_AND_DRINK')).toBe('Food & Drink');
    expect(categorize('spotify', null, 'ENTERTAINMENT')).toBe('Entertainment');
    expect(categorize('amazon', null, 'GENERAL_MERCHANDISE')).toBe('Shopping');
    expect(categorize('rent', null, 'RENT_AND_UTILITIES')).toBe('Bills & Utilities');
    expect(categorize('doctor', null, 'MEDICAL')).toBe('Medical');
    expect(categorize('uber', null, 'TRANSPORTATION')).toBe('Transportation');
    expect(categorize('hotel', null, 'TRAVEL')).toBe('Travel');
    expect(categorize('transfer', null, 'TRANSFER_IN')).toBe('Transfer');
    expect(categorize('transfer', null, 'TRANSFER_OUT')).toBe('Transfer');
  });

  it('maps Capital One CSV categories', () => {
    expect(categorize('amazon', null, 'Merchandise')).toBe('Shopping');
    expect(categorize('gas', null, 'Gas/Automotive')).toBe('Transportation');
    expect(categorize('flight', null, 'Other Travel')).toBe('Travel');
    expect(categorize('utilities', null, 'Utilities')).toBe('Bills & Utilities');
    expect(categorize('phone', null, 'Phone/Cable')).toBe('Bills & Utilities');
    expect(categorize('food', null, 'Food & Dining')).toBe('Food & Drink');
    expect(categorize('groceries', null, 'Groceries')).toBe('Food & Drink');
    expect(categorize('doctor', null, 'Healthcare')).toBe('Medical');
    expect(categorize('other', null, 'OTHER')).toBe('Uncategorized');
  });
});

describe('name-match rules', () => {
  it('matches transaction name case-insensitively', () => {
    insertRule.run(0, 'name', 'starbucks', 'Food & Drink', null, null);
    expect(categorize('STARBUCKS #1234', null, null)).toBe('Food & Drink');
    expect(categorize('Starbucks Coffee', null, null)).toBe('Food & Drink');
    expect(categorize('starbucks downtown', null, null)).toBe('Food & Drink');
  });

  it('matches partial name (contains)', () => {
    insertRule.run(0, 'name', 'whole foods', 'Grocery', null, null);
    expect(categorize('WHOLEFDS #123 AUSTIN TX', null, null)).toBe('Uncategorized'); // not a substring
    expect(categorize('Whole Foods Market #123', null, null)).toBe('Grocery');
  });

  it('matches against merchant name when different from transaction name', () => {
    insertRule.run(0, 'name', 'whole foods', 'Grocery', null, null);
    expect(categorize('WFM#0001 TX', 'Whole Foods Market', null)).toBe('Grocery');
  });

  it('does not match merchant name when same as transaction name', () => {
    insertRule.run(0, 'name', 'amazon', 'Shopping', null, null);
    // Only one haystack when merchant === name
    expect(categorize('amazon', 'amazon', null)).toBe('Shopping');
  });

  it('user rules beat Plaid fallback category', () => {
    insertRule.run(0, 'name', 'netflix', 'Subscriptions', null, null);
    expect(categorize('Netflix.com', null, 'ENTERTAINMENT')).toBe('Subscriptions');
  });
});

describe('regex rules', () => {
  it('matches regex pattern case-insensitively', () => {
    insertRule.run(0, 'regex', 'netflix|hulu|spotify', 'Entertainment', null, null);
    expect(categorize('NETFLIX.COM', null, null)).toBe('Entertainment');
    expect(categorize('Hulu monthly', null, null)).toBe('Entertainment');
    expect(categorize('SPOTIFY USA', null, null)).toBe('Entertainment');
    expect(categorize('Amazon Prime', null, null)).toBe('Uncategorized');
  });

  it('matches regex against merchant name too', () => {
    insertRule.run(0, 'regex', '^amzn\\*', 'Shopping', null, null);
    expect(categorize('AMZN*MKTP US', null, null)).toBe('Shopping');
    expect(categorize('SQ *AMZN', 'AMZN*DIGITAL', null)).toBe('Shopping'); // merchant matches
  });
});

describe('priority ordering', () => {
  it('higher priority rule wins', () => {
    insertRule.run(5, 'name', 'amazon', 'Shopping', null, null);
    insertRule.run(10, 'name', 'amazon', 'Services', null, null); // higher priority
    expect(categorize('Amazon.com', null, null)).toBe('Services');
  });

  it('lower priority rule applies when higher does not match', () => {
    insertRule.run(10, 'name', 'starbucks', 'Coffee', null, null);
    insertRule.run(5, 'name', 'amazon', 'Shopping', null, null);
    expect(categorize('Amazon.com', null, null)).toBe('Shopping');
  });

  it('first rule (highest priority) wins among ties', () => {
    // SQLite returns equal-priority rules in insertion order
    insertRule.run(0, 'name', 'venmo', 'Transfer', null, null);
    insertRule.run(0, 'name', 'venmo', 'Phone Bill', null, null);
    expect(categorize('VENMO PAYMENT', null, null)).toBe('Transfer');
  });
});

describe('amount filtering', () => {
  it('skips rule when amount is below min_amount', () => {
    insertRule.run(0, 'name', 'venmo', 'Phone Bill', 54.79, 54.79);
    expect(categorize('VENMO PAYMENT', null, null, 10.00)).toBe('Uncategorized');
  });

  it('skips rule when amount is above max_amount', () => {
    insertRule.run(0, 'name', 'venmo', 'Phone Bill', 54.79, 54.79);
    expect(categorize('VENMO PAYMENT', null, null, 100.00)).toBe('Uncategorized');
  });

  it('applies rule when amount is exactly at min_amount', () => {
    insertRule.run(0, 'name', 'venmo', 'Phone Bill', 54.79, 54.79);
    expect(categorize('VENMO PAYMENT', null, null, 54.79)).toBe('Phone Bill');
  });

  it('applies rule when amount is in range', () => {
    insertRule.run(0, 'name', 'rent', 'Rent', 1000, 3000);
    expect(categorize('ZELLE TO LANDLORD', null, null, 2000)).toBe('Uncategorized'); // name mismatch
    insertRule.run(0, 'name', 'zelle to landlord', 'Rent', 1000, 3000);
    expect(categorize('ZELLE TO LANDLORD', null, null, 2000)).toBe('Rent');
    expect(categorize('ZELLE TO LANDLORD', null, null, 500)).toBe('Uncategorized');
  });

  it('skips amount check when amount is undefined (rule applies unconditionally)', () => {
    insertRule.run(0, 'name', 'venmo', 'Phone Bill', 54.79, 54.79);
    // No amount provided → amount filter skipped → rule applies
    expect(categorize('VENMO PAYMENT', null, null, undefined)).toBe('Phone Bill');
  });

  it('applies min_amount only rule', () => {
    insertRule.run(0, 'name', 'check', 'Large Check', 500, null);
    expect(categorize('CHECK #1234', null, null, 499)).toBe('Uncategorized');
    expect(categorize('CHECK #1234', null, null, 500)).toBe('Large Check');
    expect(categorize('CHECK #1234', null, null, 9999)).toBe('Large Check');
  });

  it('applies max_amount only rule', () => {
    insertRule.run(0, 'name', 'atm', 'Cash', null, 200);
    expect(categorize('ATM WITHDRAWAL', null, null, 201)).toBe('Uncategorized');
    expect(categorize('ATM WITHDRAWAL', null, null, 200)).toBe('Cash');
    expect(categorize('ATM WITHDRAWAL', null, null, 1)).toBe('Cash');
  });

  it('falls through to next rule when amount out of range', () => {
    insertRule.run(0, 'name', 'venmo', 'Phone Bill', 54.79, 54.79);
    insertRule.run(0, 'name', 'venmo', 'Transfer', null, null);
    // Amount doesn't match first rule → falls to second
    expect(categorize('VENMO PAYMENT', null, null, 200)).toBe('Transfer');
  });
});
