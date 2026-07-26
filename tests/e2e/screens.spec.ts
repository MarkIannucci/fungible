import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Screen sweep: boots one Electron instance against a temp data dir pre-seeded
// with the demo dataset (scripts/seed-demo.ts), then visits every SideNav screen
// and asserts it renders through the real bridge → core/queries → DB path
// without tripping the ErrorBoundary. Complements launch.spec.ts, which proves
// boot on an EMPTY db; this proves every screen's read path against realistic
// rows — the class of breakage the jsdom tests (stubbed bridge) can't catch.

const MAIN_ENTRY = fileURLToPath(new URL('../../out/main/index.js', import.meta.url));
const SEED_SCRIPT = fileURLToPath(new URL('./seed-db.ts', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// nav = SideNav button label; heading = the screen's <h1> (Health's differs);
// marker = seeded text that only appears if the screen's queries returned real
// rows (null where the screen has no stable seeded datum to look for).
const SCREENS: { nav: string; heading: string; marker: string | null }[] = [
  { nav: 'Dashboard', heading: 'Dashboard', marker: 'Grocery' },
  { nav: 'Transactions', heading: 'Transactions', marker: 'Whole Foods' },
  { nav: 'Trends', heading: 'Trends', marker: null },
  { nav: 'Net Worth', heading: 'Net Worth', marker: 'High-Yield Savings' },
  { nav: 'Tags', heading: 'Tags', marker: 'tokyo trip' },
  { nav: 'Health', heading: 'Financial Health', marker: null },
  { nav: 'Rules', heading: 'Rules', marker: 'STARBUCKS' },
  { nav: 'Accounts', heading: 'Accounts', marker: 'Everyday Checking' },
  { nav: 'Canvas', heading: 'Canvas', marker: null },
  { nav: 'Settings', heading: 'Settings', marker: null },
];

let app: ElectronApplication;
let win: Page;
let dataDir: string;

// One boot for the whole sweep (unlike launch.spec.ts's per-test boots): the
// point here is per-screen coverage, not boot coverage, and each screen remounts
// through its own keyed ErrorBoundary so failures can't leak across tests.
test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'fungible-e2e-sweep-'));
  // Seed before launch. We can't just set FUNGIBLE_DEMO on the app process —
  // gui/main/index.ts redirects that to ~/.fungible-demo, defeating the temp-dir
  // isolation — so run the same seeder out-of-process against the temp dir.
  execFileSync(process.execPath, ['--import', 'tsx/esm', SEED_SCRIPT], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, FUNGIBLE_DATA_DIR: dataDir },
  });
  app = await electron.launch({
    args: [MAIN_ENTRY, ...(process.env.CI ? ['--no-sandbox'] : [])],
    env: { ...process.env, FUNGIBLE_DATA_DIR: dataDir },
  });
  win = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

for (const { nav, heading, marker } of SCREENS) {
  test(`${nav} renders seeded data with no error boundary`, async () => {
    await win.getByRole('button', { name: nav }).click();
    await expect(win.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    if (marker) await expect(win.getByText(marker).first()).toBeVisible();
    await expect(win.getByText('Something went wrong')).toHaveCount(0);
  });
}
