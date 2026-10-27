import { create } from 'zustand';

export type View =
  | 'chat'
  | 'memory'
  | 'brain'
  | 'tasks'
  | 'calendar'
  | 'spaces'
  | 'passwords'
  | 'activity'
  | 'connections'
  | 'settings'
  | 'copilot'
  | 'bible'
  | 'automations'
  | 'skills'
  | 'apps'
  | 'npcs'
  | 'compare'
  | 'router';

/** Old sidebar views that now live in Settings (links and toasts still use these names). */
const IN_SETTINGS: Partial<Record<View, string>> = { activity: 'activity', bible: 'bible' };

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  action?: 'settings:brain' | 'settings:voice' | 'memory' | 'connections' | undefined;
}

interface UiState {
  view: View;
  settingsSection: string;
  /** AI Router tab to open (go('router', tab)); the view clears it once used. */
  routerTab: string | null;
  /** Spaces view target: "Space" or "Space/Page"; null = the Spaces dashboard. */
  spaceTarget: string | null;
  activityOpen: boolean;
  /** Sidebar hidden by Sir (Ctrl+B) or, while a Core panel is up, by Jarvis (railAuto). */
  railHidden: boolean;
  railAuto: boolean;
  historyOpen: boolean;
  toasts: Toast[];
  online: boolean;
  go(view: View, section?: string): void;
  toggleActivity(): void;
  toggleRail(): void;
  /** Jarvis hides the sidebar to make room (and gives it back) unless Sir chose himself. */
  autoRail(hide: boolean): void;
  setHistoryOpen(open: boolean): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  setOnline(online: boolean): void;
}

let nextToast = 1;
const RAIL_KEY = 'jarvis.rail.hidden';

function readRailHidden(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRailHidden(hidden: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, hidden ? '1' : '0');
  } catch {
    // not fatal: the choice just isn't remembered
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  view: 'chat',
  settingsSection: 'brain',
  routerTab: null,
  spaceTarget: null,
  // §5.1: the conversation log owns the right edge of Core now, so activity starts closed.
  activityOpen: false,
  railHidden: readRailHidden(),
  railAuto: false,
  historyOpen: false,
  toasts: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  go: (view, section) => {
    const moved = IN_SETTINGS[view];
    if (moved) return set({ view: 'settings', settingsSection: moved });
    set(
      view === 'spaces'
        ? { view, spaceTarget: section ?? null }
        : view === 'router'
          ? { view, routerTab: section ?? null }
          : { view, ...(section ? { settingsSection: section } : {}) },
    );
  },
  toggleActivity: () => set({ activityOpen: !get().activityOpen }),
  toggleRail: () => {
    const railHidden = !get().railHidden;
    writeRailHidden(railHidden);
    set({ railHidden, railAuto: false });
  },
  autoRail: (hide) => {
    const { railHidden, railAuto } = get();
    if (hide && !railHidden) set({ railHidden: true, railAuto: true });
    if (!hide && railAuto) set({ railHidden: false, railAuto: false });
  },
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  toast(t) {
    const id = nextToast++;
    // Design-system.md §5.6: max 3; info/warn disappear after 4 s, errors stay until dismissed.
    set({ toasts: [...get().toasts, { ...t, id }].slice(-3) });
    if (t.level !== 'error') setTimeout(() => get().dismiss(id), 4000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setOnline: (online) => set({ online }),
}));
