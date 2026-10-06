import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  type EventChannel,
} from '../shared/ipc-channels';

// Security.md §7: one fixed function per channel. The renderer cannot name an arbitrary channel.
const call = Object.freeze(
  Object.fromEntries(
    INVOKE_CHANNELS.map((ch) => [ch, (req: unknown) => ipcRenderer.invoke(ch, req)]),
  ),
);
const send = Object.freeze(
  Object.fromEntries(
    SEND_CHANNELS.map((ch) => [ch, (payload: unknown) => ipcRenderer.send(ch, payload)]),
  ),
);
const events = new Set<string>(EVENT_CHANNELS);

function on(event: EventChannel, handler: (payload: unknown) => void): () => void {
  if (!events.has(event)) throw new Error(`Unknown event: ${String(event)}`);
  const listener = (_e: IpcRendererEvent, payload: unknown): void => handler(payload);
  ipcRenderer.on(event, listener);
  return () => {
    ipcRenderer.removeListener(event, listener);
  };
}

contextBridge.exposeInMainWorld('jarvis', Object.freeze({ call, send, on }));
