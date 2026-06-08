import React, { createContext, useContext, useState } from 'react';
import { EMPTY_FILTER, type Filter } from '../core/filters.js';

// Session-global filter shared across Dashboard, Transactions, and Trends.
// State lives above the screens so applying a filter on one carries to the
// others. It is intentionally not persisted to disk — it resets each session.

type FilterCtx = { filter: Filter; setFilter: (f: Filter) => void };

const Ctx = createContext<FilterCtx>({ filter: EMPTY_FILTER, setFilter: () => {} });

export function FilterProvider({ initial, children }: { initial?: Filter; children: React.ReactNode }) {
  const [filter, setFilter] = useState<Filter>(initial ?? EMPTY_FILTER);
  return <Ctx.Provider value={{ filter, setFilter }}>{children}</Ctx.Provider>;
}

export function useFilter(): FilterCtx {
  return useContext(Ctx);
}
