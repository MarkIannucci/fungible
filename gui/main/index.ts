import { config } from 'dotenv';
import { join } from 'node:path';
import { DATA_DIR } from '../../core/paths.js';

// Env must load before core/db.ts evaluates (it reads Turso vars at import time),
// hence the dynamic import of everything else.
config({ path: join(DATA_DIR, '.env'), quiet: true });

await import('./app.js');
