import { create } from 'zustand';
import type { Res } from '@shared/ipc-contract';
import type { BrainRef } from '@shared/llm-providers';
import type { Npc, NpcInput, NpcMeeting, NpcMessage, NpcState } from '@shared/npcs';
import { call, cleanError } from '../lib/api';
import { useUiStore } from './ui-store';

type ToolInfo = Res<'npcs:list'>['tools'][number];

/** A line an NPC just said, shown as a speech bubble over its desk for a few seconds. */
export interface Bubble {
  text: string;
  at: number;
}

interface NpcStoreState {
  npcs: Npc[];
  states: Record<string, NpcState>;
  brains: BrainRef[];
  /** Names of Sir's extra connections (conn_…). */
  brainLabels: Record<string, string>;
  tools: ToolInfo[];
  loaded: boolean;
  channels: Record<string, NpcMessage[]>;
  meetings: NpcMeeting[];
  bubbles: Record<string, Bubble>;
  load(): Promise<void>;
  loadChannel(channel: string): Promise<void>;
  loadMeetings(): Promise<void>;
  send(channel: string, text: string): Promise<void>;
  save(input: NpcInput, id?: string): Promise<Npc | null>;
  remove(id: string): Promise<void>;
  toggle(npc: Npc): Promise<void>;
  onMessage(m: NpcMessage): void;
  onStatus(id: string, state: NpcState): void;
  onMeeting(m: NpcMeeting): void;
}

const BUBBLE_MS = 9000;

async function guarded<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    useUiStore.getState().toast({ level: 'error', message: cleanError(err) });
    return null;
  }
}

export const toInput = (n: Npc): NpcInput => ({
  name: n.name,
  role: n.role,
  emoji: n.emoji,
  color: n.color,
  brain: n.brain,
  instructions: n.instructions,
  tools: n.tools,
  enabled: n.enabled,
  templateId: n.templateId,
});

export const useNpcStore = create<NpcStoreState>((set, get) => ({
  npcs: [],
  states: {},
  brains: [],
  brainLabels: {},
  tools: [],
  loaded: false,
  channels: {},
  meetings: [],
  bubbles: {},

  async load() {
    const r = await guarded(call('npcs:list', {}));
    if (r)
      set({
        npcs: r.npcs,
        states: r.states,
        brains: r.brains,
        brainLabels: r.brainLabels,
        tools: r.tools,
        loaded: true,
      });
  },
  async loadChannel(channel) {
    const msgs = await guarded(call('npcs:messages', { channel }));
    if (msgs) set({ channels: { ...get().channels, [channel]: msgs } });
  },
  async loadMeetings() {
    const m = await guarded(call('npcs:meetings', {}));
    if (m) set({ meetings: m });
  },
  async send(channel, text) {
    await guarded(call('npcs:send', { channel, text }));
  },
  async save(input, id) {
    const npc = await guarded(id ? call('npcs:update', { id, input }) : call('npcs:create', input));
    if (npc) await get().load();
    return npc;
  },
  async remove(id) {
    if (await guarded(call('npcs:delete', { id }))) await get().load();
  },
  async toggle(npc) {
    await get().save({ ...toInput(npc), enabled: !npc.enabled }, npc.id);
  },

  onMessage(m) {
    const list = get().channels[m.channel];
    const bubbles =
      m.author.startsWith('npc_') || m.author === 'jarvis'
        ? { ...get().bubbles, [m.author]: { text: m.text, at: Date.now() } }
        : get().bubbles;
    set({
      bubbles,
      // The channel may have loaded this message already (load and event racing).
      ...(list && !list.some((x) => x.id === m.id)
        ? { channels: { ...get().channels, [m.channel]: [...list, m] } }
        : {}),
    });
    setTimeout(() => {
      const b = get().bubbles[m.author];
      if (b && Date.now() - b.at >= BUBBLE_MS) {
        const { [m.author]: _gone, ...rest } = get().bubbles;
        set({ bubbles: rest });
      }
    }, BUBBLE_MS);
  },
  onStatus(id, state) {
    set({ states: { ...get().states, [id]: state } });
  },
  onMeeting(m) {
    const others = get().meetings.filter((x) => x.id !== m.id);
    set({ meetings: [m, ...others] });
  },
}));
