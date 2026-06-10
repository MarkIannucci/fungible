import { createContext, useContext } from 'react';
import type { Screen, TxFilter } from '../../../shared/nav.js';

export type NavApi = {
  screen: Screen;
  txFilter: TxFilter;
  navigate: (s: Screen, filter?: TxFilter) => void;
};

export const NavContext = createContext<NavApi | null>(null);

export function useNav(): NavApi {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav outside NavContext');
  return nav;
}
