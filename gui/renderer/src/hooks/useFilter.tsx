import React, { createContext, useCallback, useContext, useState } from 'react';
import {
  EMPTY_FILTER,
  pushFilter,
  popFilter as popFilterCore,
  type Filter,
  type FilterHistory,
} from '../../../../core/filters.js';

// Session-global filter shared across Dashboard, Transactions, and Trends —
// the GUI counterpart of tui/FilterContext.tsx. Not persisted; resets per session.
// Every setFilter pushes the previous value onto a bounded history stack so
// popFilter can step back one level at a time (Esc in Transactions).

type FilterCtx = {
  filter: Filter;
  setFilter: (f: Filter) => void;
  popFilter: () => void;
  canPop: boolean;
};

const Ctx = createContext<FilterCtx>({
  filter: EMPTY_FILTER,
  setFilter: () => {},
  popFilter: () => {},
  canPop: false,
});

export function FilterProvider({ initial, children }: { initial?: Filter; children: React.ReactNode }) {
  const [hist, setHist] = useState<FilterHistory>({ current: initial ?? EMPTY_FILTER, stack: [] });
  const setFilter = useCallback((f: Filter) => setHist((h) => pushFilter(h, f)), []);
  const popFilter = useCallback(() => setHist(popFilterCore), []);
  return (
    <Ctx.Provider value={{ filter: hist.current, setFilter, popFilter, canPop: hist.stack.length > 0 }}>
      {children}
    </Ctx.Provider>
  );
}

export function useFilter(): FilterCtx {
  return useContext(Ctx);
}
