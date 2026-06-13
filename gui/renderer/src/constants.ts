// Display constants mirrored from tui/ui.ts and tui/Accounts.tsx (which import Ink, so the renderer can't).
export const SUBTYPE_DISPLAY: Record<string, string> = {
  'crypto exchange': 'crypto',
};

export const ACCOUNT_TYPES = ['depository', 'investment', 'credit', 'loan', 'other'] as const;

export const SUBTYPES: Record<string, string[]> = {
  depository: ['checking', 'savings', 'money market', 'cd', 'hsa', 'prepaid', 'cash management', 'ebt', 'paypal'],
  investment: ['brokerage', '401k', 'ira', 'roth', 'roth 401k', '403b', '457b', '529', 'hsa', 'pension', 'mutual fund', 'stock plan', 'sep ira', 'simple ira', 'thrift savings plan', 'ugma', 'utma'],
  credit: ['credit card', 'paypal'],
  loan: ['mortgage', 'student', 'auto', 'home equity', 'personal', 'line of credit', 'business', 'other'],
  other: [],
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
