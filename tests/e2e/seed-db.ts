// Seeds the demo dataset into whatever FUNGIBLE_DATA_DIR points at. Run as a
// child process by screens.spec.ts before Electron launches: core/db.ts resolves
// FUNGIBLE_DATA_DIR at import time, so the seed must happen in a process whose
// env already carries the temp dir — it can't run inside the Playwright process.
import { initDb } from '../../core/db.js';
import { seedDemo } from '../../scripts/seed-demo.js';

await initDb();
await seedDemo();
