import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { TEST_DATA_DIR } = vi.hoisted(() => {
  const os = require('os') as typeof import('os');
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const dir = path.join(os.tmpdir(), `fungible-env-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return { TEST_DATA_DIR: dir };
});

vi.mock('../core/paths.js', () => ({ DATA_DIR: TEST_DATA_DIR }));

import { writeEnvFile } from '../core/env-file.js';

const ENV_PATH = path.join(TEST_DATA_DIR, '.env');

beforeEach(() => {
  if (fs.existsSync(ENV_PATH)) fs.rmSync(ENV_PATH);
});

afterAll(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

describe('writeEnvFile', () => {
  it('creates the file when missing and writes the provided values', () => {
    const { written } = writeEnvFile({ PLAID_CLIENT_ID: 'abc', PLAID_SECRET: 'shh' });
    expect(written.sort()).toEqual(['PLAID_CLIENT_ID', 'PLAID_SECRET']);
    expect(fs.readFileSync(ENV_PATH, 'utf8')).toBe('PLAID_CLIENT_ID=abc\nPLAID_SECRET=shh\n');
  });

  it('replaces existing keys in place and preserves untouched keys, comments, and blank lines', () => {
    fs.writeFileSync(
      ENV_PATH,
      '# bank\nPLAID_CLIENT_ID=old\nPLAID_SECRET=oldsecret\n\n# other\nFUNGIBLE_BACKUP_DAYS=14\n',
    );
    writeEnvFile({ PLAID_CLIENT_ID: 'new' });
    expect(fs.readFileSync(ENV_PATH, 'utf8')).toBe(
      '# bank\nPLAID_CLIENT_ID=new\nPLAID_SECRET=oldsecret\n\n# other\nFUNGIBLE_BACKUP_DAYS=14\n',
    );
  });

  it('appends keys that did not previously exist', () => {
    fs.writeFileSync(ENV_PATH, 'PLAID_CLIENT_ID=abc\n');
    writeEnvFile({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(fs.readFileSync(ENV_PATH, 'utf8')).toBe('PLAID_CLIENT_ID=abc\nANTHROPIC_API_KEY=sk-ant-test\n');
  });

  it('skips empty/whitespace values without touching their existing entries', () => {
    fs.writeFileSync(ENV_PATH, 'PLAID_CLIENT_ID=keepme\n');
    const { written } = writeEnvFile({ PLAID_CLIENT_ID: '   ', ANTHROPIC_API_KEY: '' });
    expect(written).toEqual([]);
    expect(fs.readFileSync(ENV_PATH, 'utf8')).toBe('PLAID_CLIENT_ID=keepme\n');
  });

  it('trims provided values before writing', () => {
    writeEnvFile({ OPENAI_API_KEY: '  sk-foo  ' });
    expect(fs.readFileSync(ENV_PATH, 'utf8')).toBe('OPENAI_API_KEY=sk-foo\n');
  });

  it('writes the file with 0600 perms', () => {
    writeEnvFile({ PLAID_SECRET: 'shh' });
    const mode = fs.statSync(ENV_PATH).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
