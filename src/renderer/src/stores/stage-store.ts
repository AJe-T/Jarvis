import { create } from 'zustand';
import type { StagePanel } from '@shared/stage';
import { isDockedKind } from '@shared/jarvis-apps';
import { useUiStore } from './ui-store';

interface StageState {
  /** The panel beside the orb on Core (Design-system.md §5.2a); null = the orb has the stage. */
  panel: StagePanel | null;
  /** Bumped on every show, so showing the same kind again restarts it (a fresh timer). */
  serial: number;
  show(panel: StagePanel | null): void;
}

export const useStageStore = create<StageState>((set, get) => ({
  panel: null,
  serial: 0,
  show(panel) {
    const same = panel && get().panel?.kind === panel.kind && isDockedKind(panel.kind);
    set({ panel, serial: same ? get().serial : get().serial + 1 });
    const ui = useUiStore.getState();
    // Jarvis takes the room he needs: Core comes forward and the sidebar steps aside until he's done.
    if (panel && ui.view !== 'chat') ui.go('chat');
    ui.autoRail(panel !== null);
  },
}));
