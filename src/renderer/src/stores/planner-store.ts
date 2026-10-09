import { create } from 'zustand';
import type { CalEvent, Calendar, Todo, TodoList } from '@shared/planner';
import { call } from '../lib/api';
import { useUiStore } from './ui-store';

interface PlannerState {
  lists: TodoList[];
  todos: Todo[];
  calendars: Calendar[];
  events: CalEvent[];
  loaded: boolean;
  /** A task to open in the Tasks view (set by the Calendar when Sir clicks a task). */
  focusTodo: string | null;
  setFocusTodo(id: string | null): void;
  /** Reloads everything; main sends planner:changed after every change (views, Jarvis, reminders). */
  refresh(): Promise<void>;
}

export const usePlannerStore = create<PlannerState>((set) => ({
  lists: [],
  todos: [],
  calendars: [],
  events: [],
  loaded: false,
  focusTodo: null,
  setFocusTodo: (id) => set({ focusTodo: id }),
  async refresh() {
    try {
      set({ ...(await call('planner:state', {})), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

/** Runs a planner call and shows a toast when it fails (the store refreshes on success by itself). */
export async function plannerCall<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    useUiStore.getState().toast({
      level: 'error',
      message: err instanceof Error ? err.message : 'That change failed.',
    });
    return null;
  }
}
