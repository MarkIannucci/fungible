import { db } from './db.js';

type Rule = {
  match_type: 'name' | 'regex';
  pattern: string;
  category: string;
};

// Plaid's personal_finance_category → our simplified categories
const PLAID_CATEGORY_MAP: Record<string, string> = {
  // Plaid API categories
  INCOME: 'Income',
  TRANSFER_IN: 'Transfer',
  TRANSFER_OUT: 'Transfer',
  LOAN_PAYMENTS: 'Loan Payment',
  BANK_FEES: 'Fees',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Food & Drink',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Home',
  MEDICAL: 'Medical',
  PERSONAL_CARE: 'Personal Care',
  GENERAL_SERVICES: 'Services',
  GOVERNMENT_AND_NON_PROFIT: 'Government',
  TRANSPORTATION: 'Transportation',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: 'Bills & Utilities',

  // Capital One CSV export categories
  'Merchandise': 'Shopping',
  'Gas/Automotive': 'Transportation',
  'Other Travel': 'Travel',
  'Payment/Credit': 'Transfer',
  'Other Services': 'Services',
  'Entertainment': 'Entertainment',
  'Utilities': 'Bills & Utilities',
  'Phone/Cable': 'Bills & Utilities',
  'Food & Dining': 'Food & Drink',
  'Groceries': 'Food & Drink',
  'Healthcare': 'Medical',
  'Personal': 'Personal Care',
  'Education': 'Services',
  'OTHER': 'Uncategorized',
};

export function categorize(name: string, merchant: string | null, plaidCategory: string | null): string {
  const rules = db.prepare('SELECT match_type, pattern, category FROM category_rules ORDER BY priority DESC').all() as Rule[];

  const haystacks = [name.toLowerCase()];
  if (merchant && merchant.toLowerCase() !== name.toLowerCase()) haystacks.push(merchant.toLowerCase());

  for (const rule of rules) {
    if (rule.match_type === 'name') {
      if (haystacks.some((h) => h.includes(rule.pattern.toLowerCase()))) return rule.category;
    } else if (rule.match_type === 'regex') {
      const re = new RegExp(rule.pattern, 'i');
      if (haystacks.some((h) => re.test(h))) return rule.category;
    }
  }

  if (plaidCategory && PLAID_CATEGORY_MAP[plaidCategory]) {
    return PLAID_CATEGORY_MAP[plaidCategory];
  }

  return 'Uncategorized';
}
