import { contextBridge, ipcRenderer } from 'electron';

// The meeting recorder's whole API: two fixed sends, nothing to call or listen to (Security.md §7).
contextBridge.exposeInMainWorld(
  'meeting',
  Object.freeze({
    frame: (who: 'you' | 'them', bytes: Uint8Array) =>
      ipcRenderer.send('meeting:frame', who, bytes),
    track: (who: 'you' | 'them', state: 'started' | 'failed', detail: string) =>
      ipcRenderer.send('meeting:track', who, state, detail),
  }),
);
