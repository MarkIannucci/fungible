export const BAR_WIDTH = 20;

export function fmt(n: number, decimals = 2): string {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function fmtSigned(n: number, decimals = 2): string {
  return `${n >= 0 ? '+' : '-'}${fmt(n, decimals)}`;
}

export function fmtPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function fmtMonths(n: number): string {
  if (!isFinite(n) || n > 999) return '∞';
  return `${n.toFixed(1)} mo`;
}

export function bar(amount: number, max: number, width = BAR_WIDTH): string {
  const filled = max > 0 ? Math.min(width, Math.max(0, Math.round((Math.abs(amount) / max) * width))) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
