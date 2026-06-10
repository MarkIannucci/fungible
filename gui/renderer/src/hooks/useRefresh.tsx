import React, { createContext, useContext, useEffect, useState } from 'react';

const RefreshContext = createContext(0);

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState(0);
  useEffect(() => window.__bridge.on('refresh', () => setKey((k) => k + 1)), []);
  return <RefreshContext.Provider value={key}>{children}</RefreshContext.Provider>;
}

export function useRefreshKey(): number {
  return useContext(RefreshContext);
}
