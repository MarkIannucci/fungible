import { BrowserWindow } from 'electron';
import { onRefresh } from '../../core/refresh.js';

export function registerRefreshPush() {
  onRefresh(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('refresh');
    }
  });
}
