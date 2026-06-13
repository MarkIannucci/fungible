import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__bridge', {
  call: (ns: string, fn: string, args: unknown[]) =>
    ipcRenderer.invoke('bridge:call', ns, fn, args),
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const listener = (_e: unknown, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
