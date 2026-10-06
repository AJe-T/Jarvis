import type { Services } from '../../services';
import { logger } from '../../logging/logger';
import type { ModelStore } from '../../voice/local/model-store';
import { listAudioDevices } from '../../voice/providers';
import type { VoiceController } from '../../voice/voice-controller';
import { handle, onSend } from '../handle';

/** Phase 4 channels. Audio capture never happens in the renderer (ADR-007). */
export function registerVoiceHandlers(
  s: Services,
  voice: VoiceController,
  ui: { setActiveConversation(id: string | null): void; isTest: boolean },
  local: { models: ModelStore; changed(): void },
): void {
  const { models } = local;
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
  // ADR-011: only the pinned files in models.json can be downloaded; progress arrives as models:progress.
  handle('models:status', () => models.status());
  handle('models:download', (req) => {
    s.audit.append('user', 'voice.modelDownload', { id: req.id });
    void models
      .download(req.id)
      .then(() => local.changed())
      .catch((err: unknown) =>
        logger.warn({ err: String(err), id: req.id }, 'model download failed'),
      );
    return { ok: true };
  });
  handle('models:cancel', (req) => {
    models.cancel(req.id);
    return { ok: true };
  });
  handle('models:delete', async (req) => {
    await models.remove(req.id);
    s.audit.append('user', 'voice.modelDelete', { id: req.id });
    return { ok: true };
  });
  onSend('tts:playback', (p) => voice.onPlayback(p.utteranceId, p.event));
  onSend('ui:activeConversation', (p) => ui.setActiveConversation(p.conversationId));
}
