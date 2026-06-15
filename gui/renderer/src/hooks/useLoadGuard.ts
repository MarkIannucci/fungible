import { useCallback, useRef } from 'react';

export function useLoadGuard() {
  const seq = useRef(0);
  const begin = useCallback(() => ++seq.current, []);
  const isLatest = useCallback((token: number) => token === seq.current, []);
  return { begin, isLatest } as const;
}
