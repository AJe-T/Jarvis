import { contextBridge, ipcRenderer } from 'electron';

// Jarvis Terminal (ADR-032): run, stop, list and clear its own commands; nothing else.
contextBridge.exposeInMainWorld(
  'terminal',
  Object.freeze({
    run: (command: string) => ipcRenderer.invoke('terminal:run', String(command)),
    stop: () => ipcRenderer.invoke('terminal:stop'),
    history: () => ipcRenderer.invoke('terminal:history'),
    clear: () => ipcRenderer.invoke('terminal:clear'),
    onEntry: (cb: (entry: unknown) => void) => {
      ipcRenderer.on('terminal:entry', (_e, entry: unknown) => cb(entry));
    },
  }),
);
