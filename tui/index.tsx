import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { initDb } from '../core/db.js';
import { syncAll } from '../core/sync.js';
import { App } from './App.js';

initDb();
syncAll().catch(() => {}); // sync in background, ignore errors

render(<App />);
