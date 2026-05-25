import { config } from 'dotenv';
import { join } from 'node:path';
import { DATA_DIR } from '../core/paths.js';
config({ path: join(DATA_DIR, '.env') });
import React from 'react';
import { render } from 'ink';
import { initDb } from '../core/db.js';
import { syncAll } from '../core/sync.js';
import { rebuildDisplayNames } from '../core/rename.js';
import { App } from './App.js';
import { Setup } from './Setup.js';

const isDemo = process.argv.includes('--demo');

if (process.argv.includes('--setup')) {
  initDb();
  render(<Setup />);
} else {
  initDb();
  if (isDemo) {
    const { seedDemo } = await import('../scripts/seed-demo.js');
    seedDemo();
  }
  rebuildDisplayNames();
  if (!isDemo) syncAll().catch(() => {});
  render(<App />);
}
