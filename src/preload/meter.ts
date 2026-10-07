import { contextBridge, ipcRenderer } from 'electron';

// The music meter's whole API: two fixed sends, nothing to call or listen to (Security.md §7).
contextBridge.exposeInMainWorld(
  'meter',
  Object.freeze({
    level: (rms: number) => ipcRenderer.send('meter:level', rms),
    failed: (reason: string) => ipcRenderer.send('meter:failed', reason),
  }),
);
