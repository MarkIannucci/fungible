// Mirrors tui/App.tsx — kept separate so the renderer never imports Ink-touching code.
export type Screen =
  | 'dashboard'
  | 'transactions'
  | 'trends'
  | 'networth'
  | 'tags'
  | 'rules'
  | 'accounts'
  | 'health'
  | 'canvas'
  | 'settings';

export type TxFilter = {
  category?: string;
  from?: string;
  to?: string;
  tag?: string;
  account?: string;
  accountName?: string;
  search?: string;
  range?: string; // 'week' | 'month' | 'quarter' | 'year' | 'alltime'
  anchor?: string; // YYYY-MM-DD — which specific period to land on
  canvasSpec?: string; // JSON-encoded CanvasSpec, used when navigating to 'canvas'
  txType?: 'income' | 'expenses';
  flex?: 'fixed' | 'flexible' | 'discretionary';
};

export const SCREEN_LABELS: Record<Screen, string> = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  trends: 'Trends',
  networth: 'Net Worth',
  tags: 'Tags',
  health: 'Health',
  rules: 'Rules',
  accounts: 'Accounts',
  canvas: 'Canvas',
  settings: 'Settings',
};

// Mirrors tui/nav.tsx SCREEN_KEYS — digit keys navigate when keybindings are enabled.
export const SCREEN_KEYS: Record<string, Screen> = {
  '0': 'settings',
  '1': 'dashboard',
  '2': 'transactions',
  '3': 'trends',
  '4': 'networth',
  '5': 'tags',
  '6': 'health',
  '7': 'rules',
  '8': 'accounts',
  '9': 'canvas',
};

export const SCREEN_DIGITS: Record<Screen, string> = Object.fromEntries(
  Object.entries(SCREEN_KEYS).map(([k, s]) => [s, k]),
) as Record<Screen, string>;

export const SCREEN_ORDER: Screen[] = [
  'dashboard',
  'transactions',
  'trends',
  'networth',
  'tags',
  'health',
  'rules',
  'accounts',
  'canvas',
  'settings',
];
