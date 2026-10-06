import { useAssistantStore } from '../stores/assistant-store';
import { useChatStore } from '../stores/chat-store';
import { useSettingsStore } from '../stores/settings-store';
import { useUiStore } from '../stores/ui-store';

type Unsubscribe = () => void;
const extra: Array<(on: typeof window.jarvis.on) => Unsubscribe[]> = [];

/** Later features (confirmations, voice audio, memory) register their own event handlers here. */
export function registerBridge(fn: (on: typeof window.jarvis.on) => Unsubscribe[]): void {
  extra.push(fn);
}

/** Code-style.md §6: stores are updated from IPC events in exactly one place. */
export function startIpcBridge(): Unsubscribe {
  const on = window.jarvis.on;
  const chat = useChatStore.getState;
  const subs: Unsubscribe[] = [
    on('assistant:state', (p) => useAssistantStore.getState().setState(p.state, p.detail)),
    on('chat:delta', (p) => chat().applyDelta(p.turnId, p.conversationId, p.textDelta)),
    on('chat:message', (p) => chat().applyMessage(p.turnId, p.conversationId, p.message)),
    on('tool:update', (p) => chat().applyToolUpdate(p.turnId, p.conversationId, p.toolCall)),
    on('conversation:updated', (p) => chat().upsertConversation(p)),
    on('usage:update', (p) =>
      useSettingsStore.getState().setUsage(p.dayCostUsd, p.monthCostUsd, p.model),
    ),
    on('notify', (p) =>
      useUiStore.getState().toast({ level: p.level, message: p.message, action: p.action }),
    ),
    on('voice:level', (p) => useAssistantStore.getState().setMicLevel(p.rms)),
    on('voice:transcript', (p) => useAssistantStore.getState().setTranscript(p)),
    on('computer:active', (p) => useAssistantStore.getState().setComputerActive(p.active)),
    on('nav:open', (p) => useUiStore.getState().go(p.view, p.section)),
  ];
  for (const fn of extra) subs.push(...fn(on));
  const setOnline = (): void => useUiStore.getState().setOnline(navigator.onLine);
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
  return () => {
    for (const s of subs) s();
    window.removeEventListener('online', setOnline);
    window.removeEventListener('offline', setOnline);
  };
}
