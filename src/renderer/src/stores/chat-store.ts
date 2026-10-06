import { create } from 'zustand';
import type { ConversationSummary, UiMessage, UiToolCall } from '@shared/types';
import { call, cleanError } from '../lib/api';
import { useUiStore } from './ui-store';

export interface Attachment {
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'application/pdf';
  dataBase64: string;
}

interface LiveTurn {
  turnId: string;
  conversationId: string;
  text: string;
  toolCalls: UiToolCall[];
}

interface ChatStore {
  conversations: ConversationSummary[];
  activeId: string | null;
  messages: UiMessage[];
  live: LiveTurn | null;
  /** Tool calls of the active conversation, newest last (Activity drawer). */
  activity: UiToolCall[];
  /** True between sending the first message of a new chat and learning its conversation id. */
  awaitingId: boolean;
  loadConversations(): Promise<void>;
  open(id: string): Promise<void>;
  newConversation(): void;
  send(text: string, source?: 'text' | 'voice', attachments?: Attachment[]): Promise<void>;
  cancel(): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  applyDelta(turnId: string, conversationId: string, delta: string): void;
  applyMessage(turnId: string, conversationId: string, message: UiMessage): void;
  applyToolUpdate(turnId: string, conversationId: string, toolCall: UiToolCall): void;
  upsertConversation(c: ConversationSummary): void;
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
}

/** A turn's final chat:message can arrive before chat:send resolves (fast replies). */
const finishedTurns = new Set<string>();

/** Events for the active chat apply; the first events of a brand-new chat also claim it. */
function accepts(
  get: () => ChatStore,
  set: (p: Partial<ChatStore>) => void,
  conversationId: string,
): boolean {
  // On an empty new chat the first turn's events claim it (typed or spoken).
  if (get().activeId === null && (get().awaitingId || get().messages.length === 0)) {
    set({ activeId: conversationId, awaitingId: false });
    return true;
  }
  return get().activeId === conversationId;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  live: null,
  activity: [],
  awaitingId: false,

  async loadConversations() {
    const { items } = await call('conversations:list', { limit: 100 });
    set({ conversations: items });
  },

  async open(id) {
    const { messages } = await call('conversations:get', { id });
    set({
      activeId: id,
      messages,
      live: null,
      activity: messages.flatMap((m) => m.toolCalls ?? []),
    });
  },

  newConversation() {
    set({ activeId: null, messages: [], live: null, activity: [] });
  },

  async send(text, source = 'text', attachments = []) {
    const optimistic: UiMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      text,
      source,
      createdAt: new Date().toISOString(),
    };
    set({ messages: [...get().messages, optimistic], awaitingId: get().activeId === null });
    try {
      const { conversationId, turnId } = await call('chat:send', {
        text,
        source,
        ...(attachments.length ? { attachments } : {}),
        ...(get().activeId ? { conversationId: get().activeId as string } : {}),
      });
      const live = finishedTurns.has(turnId)
        ? null
        : get().live?.turnId === turnId
          ? get().live
          : { turnId, conversationId, text: '', toolCalls: [] };
      set({ activeId: conversationId, awaitingId: false, live });
    } catch (err) {
      set({ awaitingId: false, messages: get().messages.filter((m) => m.id !== optimistic.id) });
      useUiStore.getState().toast({ level: 'error', message: cleanError(err) });
    }
  },

  async cancel() {
    const live = get().live;
    await call('chat:cancel', live ? { turnId: live.turnId } : {});
  },

  async deleteConversation(id) {
    await call('conversations:delete', { id, alsoVault: false });
    set({ conversations: get().conversations.filter((c) => c.id !== id) });
    if (get().activeId === id) get().newConversation();
  },

  applyDelta(turnId, conversationId, delta) {
    if (!accepts(get, set, conversationId)) return;
    const live = get().live;
    const base =
      live?.turnId === turnId ? live : { turnId, conversationId, text: '', toolCalls: [] };
    set({ live: { ...base, text: base.text + delta } });
  },

  applyMessage(turnId, conversationId, message) {
    if (message.role !== 'user') finishedTurns.add(turnId);
    if (!accepts(get, set, conversationId)) return;
    const live = get().live;
    set({
      messages: [...get().messages, message],
      ...(live?.turnId === turnId && message.role !== 'user' ? { live: null } : {}),
    });
  },

  applyToolUpdate(turnId, conversationId, toolCall) {
    if (!accepts(get, set, conversationId)) return;
    const live = get().live;
    const base =
      live?.turnId === turnId
        ? live
        : { turnId, conversationId, text: live?.text ?? '', toolCalls: [] };
    set({
      live: { ...base, toolCalls: upsertById(base.toolCalls, toolCall) },
      activity: upsertById(get().activity, toolCall),
    });
  },

  upsertConversation(c) {
    const rest = get().conversations.filter((x) => x.id !== c.id);
    set({ conversations: [c, ...rest].sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1)) });
  },
}));
