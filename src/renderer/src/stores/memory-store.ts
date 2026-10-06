import { create } from 'zustand';

/** Bumped whenever the vault changes (memory:changed), so open views re-read. */
export const useMemoryStore = create<{ version: number; bump(): void }>((set, get) => ({
  version: 0,
  bump: () => set({ version: get().version + 1 }),
}));
