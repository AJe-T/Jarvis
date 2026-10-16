import { contextBridge, ipcRenderer } from 'electron';

// Jarvis Camera (ADR-040): save a photo, show the last one in its folder; nothing else.
contextBridge.exposeInMainWorld(
  'camera',
  Object.freeze({
    save: (jpegBase64: string) => ipcRenderer.invoke('camera:save', String(jpegBase64)),
    reveal: () => ipcRenderer.invoke('camera:reveal'),
  }),
);
