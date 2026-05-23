import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { initDb } from '../core/db.js';
import { App } from './App.js';

initDb();

render(<App />);
