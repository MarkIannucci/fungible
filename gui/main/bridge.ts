import { dialog, ipcMain } from 'electron';
import { parseCSV } from '../../core/csv.js';
import { isPlaidConfigured } from '../../core/plaid.js';
import { getDefaultDaysRequested } from '../../core/settings.js';
import { runPlaidLink } from './plaid-link.js';
import { registry } from './registry.js';

const plaid = {
  isConfigured: async (): Promise<boolean> => isPlaidConfigured(),
  getDefaultDaysRequested,
  linkBank: (daysRequested?: number) => runPlaidLink(daysRequested),
};

const files = {
  pickCsv: async (): Promise<{ path: string; headers: string[]; rows: string[][] } | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Import CSV',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    return { path, ...parseCSV(path) };
  },
};

export const fullRegistry = { ...registry, files, plaid } as const;

export function registerBridge() {
  ipcMain.handle('bridge:call', (_e, ns: string, fn: string, args: unknown[]) => {
    const namespace = (fullRegistry as Record<string, Record<string, unknown>>)[ns];
    const f = namespace?.[fn];
    if (typeof f !== 'function') throw new Error(`Unknown bridge call: ${ns}.${fn}`);
    return f(...args);
  });
}
