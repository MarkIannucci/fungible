import React, { useState } from 'react';
import { useInput, useApp } from 'ink';
import { Dashboard } from './Dashboard.js';
import { Transactions } from './Transactions.js';
import { Trends } from './Trends.js';
import { Rules } from './Rules.js';
import { Import } from './Import.js';
import { Tags } from './Tags.js';

export type Screen = 'dashboard' | 'transactions' | 'trends' | 'rules' | 'import' | 'tags';

export type TxFilter = {
  category?: string;
  month?: number;
  year?: number;
  tag?: string;
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
    case 'rules':        return <Rules onNavigate={navigate} />;
    case 'import':       return <Import onNavigate={navigate} />;
    case 'tags':         return <Tags onNavigate={navigate} />;
  }
}
