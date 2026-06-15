import { useCallback, useRef } from 'react';

// Guards a component's async loads against out-of-order completion. Filter and
// period changes can fire queries faster than they resolve, so a slow earlier
// query may land after a faster later one and paint stale data. Call begin()
// when a load group starts to claim a token, then gate each result on
// isLatest(token) so only the newest load applies; earlier ones are dropped on
// arrival. Use one guard per independent load group — queries that fire and
// resolve together and so must not invalidate one another.
export function useLoadGuard() {
  const seq = useRef(0);
  const begin = useCallback(() => ++seq.current, []);
  const isLatest = useCallback((token: number) => token === seq.current, []);
  return { begin, isLatest } as const;
}
