// Canonical fingerprint of the live database schema.
//
// Builds the schema in a throwaway database, reads back what libsql actually
// created, and prints a sha256 of it. The hash is stable across comments,
// whitespace, and statement reordering in core/db.ts — it only changes when
// the real schema (tables/indexes) changes. The release workflow uses it to
// decide patch (no schema change) vs minor (schema change).
//
//   node --import tsx/esm scripts/schema-hash.ts

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Point the db client at a disposable directory before importing it, so the
// real ~/.fungible data dir is never touched.
process.env.FUNGIBLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'fungible-schema-'));

const { db, initDb } = await import('../core/db.js');

await initDb();

const { rows } = await db.execute(
  `SELECT sql FROM sqlite_master
   WHERE type IN ('table', 'index') AND sql IS NOT NULL
   ORDER BY name`,
);

const ddl = rows.map((r) => r.sql as string).join('\n');
process.stdout.write(createHash('sha256').update(ddl).digest('hex'));
