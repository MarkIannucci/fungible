import React, { createContext, useContext, useState } from 'react';
import { EMPTY_FILTER, type Filter } from '../../../../core/filters.js';

// Session-global filter shared across Dashboard, Transactions, and Trends —
// the GUI counterpart of tui/FilterContext.tsx. Not persisted; resets per session.

type FilterCtx = { filter: Filter; setFilter: (f: Filter) => void };

const Ctx = createContext<FilterCtx>({ filter: EMPTY_FILTER, setFilter: () => {} });

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  return <Ctx.Provider value={{ filter, setFilter }}>{children}</Ctx.Provider>;
}

export function useFilter(): FilterCtx {
  return useContext(Ctx);
}
