import { contextBridge, ipcRenderer } from 'electron';

// Jarvis Browser address bar (ADR-032): fixed sends to main and two events; no other access.
contextBridge.exposeInMainWorld(
  'browserBar',
  Object.freeze({
    go: (text: string) => ipcRenderer.send('browser:go', String(text)),
    nav: (action: 'back' | 'forward' | 'reload' | 'stop' | 'home') =>
      ipcRenderer.send('browser:nav', action),
    ready: () => ipcRenderer.send('browser:ready'),
    onState: (cb: (s: unknown) => void) => {
      ipcRenderer.on('browser:state', (_e, s: unknown) => cb(s));
    },
    onFocusAddress: (cb: () => void) => {
      ipcRenderer.on('browser:focusAddress', () => cb());
    },
  }),
);
