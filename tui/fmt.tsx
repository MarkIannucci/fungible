import React from 'react';
import { Text } from 'ink';

export const BAR_WIDTH = 20;

/** $X.XX with abs value. decimals defaults to 2. */
export function fmt(n: number, decimals = 2): string {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** +$X.XX or -$X.XX */
export function fmtSigned(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : '-'}${fmt(n, decimals)}`;
}

/** Progress bar as █░ string. Uses Math.abs(amount) for safety with signed values. */
export function bar(amount: number, max: number, width = BAR_WIDTH): string {
  const filled = max > 0 ? Math.min(width, Math.max(0, Math.round((Math.abs(amount) / max) * width))) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Truncate with ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Horizontal rule. */
export function Divider({ width = 70 }: { width?: number }) {
  return <Text dimColor>{'─'.repeat(width)}</Text>;
}
