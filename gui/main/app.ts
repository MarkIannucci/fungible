import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR } from '../../core/paths.js';
import { initDb } from '../../core/db.js';
import { backupDb } from '../../core/backup.js';
import { rebuildDisplayNames } from '../../core/rename.js';
import { syncAll } from '../../core/sync.js';
import { registerBridge } from './bridge.js';
import { registerRefreshPush } from './refresh-ipc.js';
import { registerAgentIpc, rejectPendingConfirms } from './agent-ipc.js';
import { buildMenu } from './menu.js';

const isDev = !!process.env.ELECTRON_RENDERER_URL;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await initDb();
      backupDb().catch(() => {});
      await rebuildDisplayNames();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = /hrana|stream/i.test(msg)
        ? '\n\nThis usually means another fungible process (TUI or MCP server) is syncing the same Turso replica. Close it and relaunch, or run against a local data dir (npm run gui:demo).'
        : '';
      dialog.showErrorBox('fungible — database error', msg + hint);
      app.quit();
      return;
    }

    registerBridge();
    registerRefreshPush();
    registerAgentIpc();
    buildMenu();
    createWindow();

    syncAll().catch((err) => console.error('[gui] background sync failed:', err));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

const WINDOW_STATE_PATH = join(DATA_DIR, 'gui-window.json');

type WindowState = { width: number; height: number; x?: number; y?: number };

function loadWindowState(): WindowState {
  try {
    return { width: 1280, height: 840, ...JSON.parse(readFileSync(WINDOW_STATE_PATH, 'utf-8')) };
  } catch {
    return { width: 1280, height: 840 };
  }
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state,
    minWidth: 900,
    minHeight: 600,
    title: 'fungible',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM preload (.mjs) requires an unsandboxed renderer
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('close', () => {
    try {
      writeFileSync(WINDOW_STATE_PATH, JSON.stringify(win.getNormalBounds()), 'utf-8');
    } catch {
      /* non-fatal */
    }
  });
  win.on('closed', rejectPendingConfirms);

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}
