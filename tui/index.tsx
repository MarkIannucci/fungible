import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { initDb } from '../core/db.js';
import { syncAll } from '../core/sync.js';
import { rebuildDisplayNames } from '../core/rename.js';
import { App } from './App.js';
import { Setup } from './Setup.js';

if (process.argv.includes('--setup')) {
  initDb();
  render(<Setup />);
} else {
  initDb();
  rebuildDisplayNames();
  syncAll().catch(() => {});
  render(<App />);
}
