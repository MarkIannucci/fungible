import type { Screen } from './App.js';

const SCREEN_KEYS: Record<string, Screen> = {
  '1': 'dashboard',
  '2': 'transactions',
  '3': 'trends',
  '4': 'networth',
  '5': 'tags',
  '6': 'health',
  '7': 'rules',
  '8': 'accounts',
};

/**
 * Handle numeric navigation keys (1–8). Skips the current screen's own key.
 * Returns true if the key was a nav key (so callers can early-return).
 */
export function handleNavKey(
  input: string,
  current: Screen,
  onNavigate: (s: Screen) => void,
): boolean {
  const screen = SCREEN_KEYS[input];
  if (!screen || screen === current) return false;
  onNavigate(screen);
  return true;
}
