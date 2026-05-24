import React from 'react';
import { Text } from 'ink';
export { BAR_WIDTH, fmt, fmtSigned, fmtPct, fmtMonths, bar, truncate } from '../core/fmt.js';

export function Divider({ width = 70 }: { width?: number }) {
  return <Text dimColor>{'─'.repeat(width)}</Text>;
}
