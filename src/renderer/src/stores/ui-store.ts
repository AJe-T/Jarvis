import { create } from 'zustand';

export type View =
  'chat' | 'memory' | 'activity' | 'connections' | 'settings' | 'copilot' | 'bible';

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  action?: 'settings:brain' | 'settings:voice' | 'memory' | 'connections' | undefined;
}

interface UiState {
  view: View;
  settingsSection: string;
  activityOpen: boolean;
  historyOpen: boolean;
  toasts: Toast[];
  online: boolean;
  go(view: View, section?: string): void;
  toggleActivity(): void;
  setHistoryOpen(open: boolean): void;
  toast(t: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
  setOnline(online: boolean): void;
}

let nextToast = 1;

export const useUiStore = create<UiState>((set, get) => ({
  view: 'chat',
  settingsSection: 'brain',
  // §5.1: docked from lg (1200px); below that it is an overlay sheet, so start closed.
  activityOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1200,
  historyOpen: false,
  toasts: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  go: (view, section) => set({ view, ...(section ? { settingsSection: section } : {}) }),
  toggleActivity: () => set({ activityOpen: !get().activityOpen }),
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
