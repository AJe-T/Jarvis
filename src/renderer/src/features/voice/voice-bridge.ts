import type { AssistantState } from '@shared/types';
import { audioPlayer } from '../../audio/audio-player';
import { call } from '../../lib/api';
import { registerBridge } from '../../lib/ipc-bridge';
import { useAssistantStore } from '../../stores/assistant-store';
import { useChatStore } from '../../stores/chat-store';
import { useSettingsStore } from '../../stores/settings-store';

/** Renderer half of the voice pipeline: playback, chimes, Esc-to-cancel, and which chat voice turns go to. */
export function installVoiceBridge(): void {
  registerBridge((on) => [
    on('tts:audio', (p) => audioPlayer.enqueue(p)),
    on('tts:stop', () => audioPlayer.stop()),
  ]);

  let previous: AssistantState = useAssistantStore.getState().state;
  let previousDetail: string | undefined;
  useAssistantStore.subscribe((s) => {
    if (s.state === previous) return;
    const sounds = useSettingsStore.getState().values['voice.sounds'] !== false;
    // ADR-012: the follow-up window after a reply opens and closes silently, like a person waiting.
    const followUp = s.detail === 'follow-up' || previousDetail === 'follow-up';
    if (sounds && !followUp) {
      if (s.state === 'LISTENING') audioPlayer.chime('listen');
      else if (previous === 'LISTENING' && s.state === 'IDLE') audioPlayer.chime('cancel');
      else if (s.state === 'AWAITING_CONFIRMATION') audioPlayer.chime('confirm');
    }
    if (sounds && previous === 'LISTENING' && s.state === 'THINKING') audioPlayer.chime('thinking');
    previous = s.state;
    previousDetail = s.detail;
  });

  let lastActive: string | null | undefined;
  const report = (id: string | null): void => {
    if (id === lastActive) return;
    lastActive = id;
    window.jarvis.send['ui:activeConversation']({ conversationId: id });
  };
  report(useChatStore.getState().activeId);
  useChatStore.subscribe((s) => report(s.activeId));

  // App-flow.md §5: Esc cancels listening.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && useAssistantStore.getState().state === 'LISTENING')
      void call('voice:mic', { action: 'stop' });
  });
}
