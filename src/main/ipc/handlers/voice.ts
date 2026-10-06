import type { Services } from '../../services';
import { listAudioDevices } from '../../voice/providers';
import type { VoiceController } from '../../voice/voice-controller';
import { handle, onSend } from '../handle';

/** Phase 4 channels. Audio capture never happens in the renderer (ADR-007). */
export function registerVoiceHandlers(
  s: Services,
  voice: VoiceController,
  ui: { setActiveConversation(id: string | null): void; isTest: boolean },
): void {
  handle('voice:setMode', async (req) => {
    const previous = s.settings.get('voice.mode');
    s.settings.set('voice.mode', req.mode); // the settings listener also re-applies the mode
    const r = await voice.applyMode();
    if (!r.ok) s.settings.set('voice.mode', previous === req.mode ? 'off' : previous);
    return r;
  });
  handle('voice:mic', (req) => {
    voice.mic(req.action);
    return { ok: true };
  });
  handle('voice:devices', () => {
    if (ui.isTest) return [{ index: 0, name: 'Test microphone' }];
    return listAudioDevices().map((name, index) => ({ index, name }));
  });
  onSend('tts:playback', (p) => voice.onPlayback(p.utteranceId, p.event));
  onSend('ui:activeConversation', (p) => ui.setActiveConversation(p.conversationId));
}
