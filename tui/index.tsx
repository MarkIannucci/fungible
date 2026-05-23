import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { initDb } from '../core/db.js';
import { syncAll } from '../core/sync.js';
import { rebuildDisplayNames } from '../core/rename.js';
import { App } from './App.js';

initDb();
rebuildDisplayNames(); // re-apply name rules after any migrations
syncAll().catch(() => {}); // sync in background, ignore errors

render(<App />);
