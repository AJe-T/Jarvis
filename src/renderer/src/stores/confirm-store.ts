import { create } from 'zustand';
import type { EventPayload } from '@shared/ipc-contract';

export type ConfirmRequest = EventPayload<'confirm:request'>;

interface ConfirmStore {
  current: ConfirmRequest | null;
  show(r: ConfirmRequest): void;
  resolved(requestId: string): void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  current: null,
  show: (current) => set({ current }),
  resolved: (requestId) => {
    if (get().current?.requestId === requestId) set({ current: null });
  },
}));
