import { contextBridge, ipcRenderer } from 'electron';

// The capture window's whole API (Security.md §7): microphone frames and camera stills out, a few
// fixed commands in. It can't call anything else in main.
contextBridge.exposeInMainWorld(
  'capture',
  Object.freeze({
    frames: (bytes: Uint8Array) => ipcRenderer.send('capture:frames', bytes),
    micState: (state: 'started' | 'failed', detail: string) =>
      ipcRenderer.send('capture:mic', state, detail),
    snapped: (id: string, jpegBase64: string | null, error: string) =>
      ipcRenderer.send('capture:snapped', id, jpegBase64, error),
    onCommand: (cb: (cmd: unknown) => void) => {
      ipcRenderer.on('capture:command', (_e, cmd: unknown) => cb(cmd));
    },
  }),
);
