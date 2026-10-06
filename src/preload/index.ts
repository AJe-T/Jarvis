import { contextBridge } from 'electron';

// Security.md §7: minimal, typed API only. Channels are added per phase via src/shared/ipc-contract.ts.
contextBridge.exposeInMainWorld('jarvis', Object.freeze({ version: '0.0.0' }));
