import { create } from 'zustand';
import type { Res } from '@shared/ipc-contract';
import { call } from '../lib/api';

export type SpaceInfo = Res<'spaces:list'>[number];

/** The list of Spaces shown in the sidebar and on the Spaces dashboard. */
export const useSpacesStore = create<{ spaces: SpaceInfo[]; refresh(): Promise<void> }>((set) => ({
  spaces: [],
  async refresh() {
    try {
      set({ spaces: await call('spaces:list', {}) });
    } catch {
      // vault not ready yet (onboarding); the memory:changed event refreshes later
    }
  },
}));
