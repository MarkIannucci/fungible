import { useEffect, useState } from 'react';
import { useRefreshKey } from './useRefresh.js';

/** Fetch-on-mount + refetch when deps change or a refresh event arrives.
 *  Keeps the previous value while refetching to avoid flicker. */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): T | undefined {
  const refreshKey = useRefreshKey();
  const [data, setData] = useState<T>();
  useEffect(() => {
    let alive = true;
    fetcher().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey]);
  return data;
}
