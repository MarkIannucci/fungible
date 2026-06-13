import { useEffect, useState } from 'react';
import { useRefreshKey } from './useRefresh.js';

/** Fetch-on-mount + refetch when deps change or a refresh event arrives.
 *  Keeps the previous value while refetching to avoid flicker. Fetch errors
 *  are re-thrown during render so the screen error boundary catches them
 *  instead of leaving a perpetual loading state. */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): T | undefined {
  const refreshKey = useRefreshKey();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  if (error) throw error;
  useEffect(() => {
    let alive = true;
    fetcher().then(
      (d) => {
        if (alive) setData(d);
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey]);
  return data;
}
