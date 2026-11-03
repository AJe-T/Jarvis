import { create } from 'zustand';
import type { EventPayload, Res } from '@shared/ipc-contract';
import { call, cleanError } from '../lib/api';
import { registerBridge } from '../lib/ipc-bridge';
import { useUiStore } from './ui-store';

export type ForgeMessage = EventPayload<'forge:message'>['message'];
export type ForgeRunView = Res<'forge:runs'>[number];

const MAX_MESSAGES = 400;

interface ForgeStoreState {
  messages: ForgeMessage[];
  loaded: boolean;
  /** The run Forge is on (or ended last) since this window opened, live from forge:update. */
  live: ForgeRunView | null;
  /** Bumped when a run ends, so the Runs tab reloads (installer paths come from the saved file). */
  runsVersion: number;
  sending: boolean;
  load(): Promise<void>;
  send(text: string): Promise<boolean>;
  onMessage(m: ForgeMessage): void;
  onUpdate(r: ForgeRunView): void;
}

const ENDED = new Set(['passed', 'failed', 'cancelled']);

export const useForgeStore = create<ForgeStoreState>((set, get) => ({
  messages: [],
  loaded: false,
  live: null,
  runsVersion: 0,
  sending: false,

  async load() {
    try {
      const messages = await call('forge:messages', {});
      set({ messages, loaded: true });
    } catch (err) {
      set({ loaded: true });
      useUiStore.getState().toast({ level: 'error', message: cleanError(err) });
    }
  },

  async send(text) {
    set({ sending: true });
    try {
      // The saved message also arrives as forge:message; onMessage drops the duplicate.
      get().onMessage(await call('forge:send', { text }));
      return true;
    } catch (err) {
      useUiStore.getState().toast({ level: 'error', message: cleanError(err) });
      return false;
    } finally {
      set({ sending: false });
    }
  },

  onMessage(m) {
    set((s) =>
      s.messages.some((x) => x.id === m.id)
        ? s
        : { messages: [...s.messages, m].slice(-MAX_MESSAGES) },
    );
  },

  onUpdate(r) {
    set((s) => {
      const ended =
        ENDED.has(r.state) &&
        r.ship?.state !== 'running' &&
        (s.live?.id !== r.id || s.live.state !== r.state || s.live.ship?.state !== r.ship?.state);
      return { live: r, runsVersion: ended ? s.runsVersion + 1 : s.runsVersion };
    });
  },
}));

registerBridge((on) => [
  on('forge:message', (p) => useForgeStore.getState().onMessage(p.message)),
  on('forge:update', (p) => useForgeStore.getState().onUpdate(p.run)),
]);
