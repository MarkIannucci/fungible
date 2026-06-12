import { app, dialog, Menu, net, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';

const REPO = 'tomfunk/fungible';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

async function fetchLatestTag(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url: API_URL });
    // GitHub requires a User-Agent on all API requests
    req.setHeader('User-Agent', `fungible/${app.getVersion()}`);
    req.setHeader('Accept', 'application/vnd.github+json');

    const chunks: Buffer[] = [];
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }
      // Buffer and decode once at the end — per-chunk toString() corrupts
      // multi-byte UTF-8 sequences split across chunk boundaries.
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tag_name?: string };
          resolve(String(json.tag_name ?? ''));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// Compare semver-ish x.y.z, ignoring any prerelease suffix. Sufficient for
// our tags (vX.Y.Z) and good-enough for dev versions like 0.0.0-nobumpnecessary
// (parsed as 0.0.0, so any real release reads as newer).
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const ap = parse(a);
  const bp = parse(b);
  for (let i = 0; i < 3; i++) {
    if (ap[i] !== bp[i]) return ap[i] > bp[i] ? 1 : -1;
  }
  return 0;
}

async function checkForUpdates() {
  const current = app.getVersion();
  try {
    const latest = await fetchLatestTag();
    if (!latest) throw new Error('No releases found');

    if (compareVersions(latest, current) > 0) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: 'A new version of fungible is available.',
        detail: `You're on v${current}. Latest is ${latest}.`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(RELEASES_URL);
    } else {
      await dialog.showMessageBox({
        type: 'info',
        title: 'No updates',
        message: `You're on the latest version (v${current}).`,
        buttons: ['OK'],
      });
    }
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: err instanceof Error ? err.message : String(err),
      buttons: ['OK'],
    });
  }
}

export function buildMenu() {
  const isMac = process.platform === 'darwin';
  const checkForUpdatesItem: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: () => checkForUpdates(),
  };
  const githubItem: MenuItemConstructorOptions = {
    label: 'GitHub Repository',
    click: () => shell.openExternal(`https://github.com/${REPO}`),
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              checkForUpdatesItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...(isMac ? [] : [checkForUpdatesItem, { type: 'separator' } as const]),
        githubItem,
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
