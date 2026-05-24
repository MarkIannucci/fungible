import React, { useState } from 'react';
import { useInput, useApp } from 'ink';
import { Dashboard } from './Dashboard.js';
import { Transactions } from './Transactions.js';
import { Trends } from './Trends.js';
import { NetWorth } from './NetWorth.js';
import { Tags } from './Tags.js';
import { Rules } from './Rules.js';
import { Accounts } from './Accounts.js';
import { Health } from './Health.js';

export type Screen = 'dashboard' | 'transactions' | 'trends' | 'networth' | 'tags' | 'rules' | 'accounts' | 'health';

export type TxFilter = {
  category?: string;
  from?: string;
  to?: string;
  tag?: string;
  account?: string;
};

export function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [txFilter, setTxFilter] = useState<TxFilter>({});
  const { exit } = useApp();

  function navigate(s: Screen, filter?: TxFilter) {
    setTxFilter(filter ?? {});
    setScreen(s);
  }

  useInput((input) => {
    if (input === 'q') exit();
  });

  switch (screen) {
    case 'dashboard':    return <Dashboard onNavigate={navigate} />;
    case 'transactions': return <Transactions onNavigate={navigate} initialFilter={txFilter} />;
    case 'trends':       return <Trends onNavigate={navigate} initialFilter={txFilter} />;
    case 'networth':     return <NetWorth onNavigate={navigate} />;
    case 'tags':         return <Tags onNavigate={navigate} />;
    case 'rules':        return <Rules onNavigate={navigate} />;
    case 'accounts':     return <Accounts onNavigate={navigate} />;
    case 'health':       return <Health onNavigate={navigate} />;
  }
}
