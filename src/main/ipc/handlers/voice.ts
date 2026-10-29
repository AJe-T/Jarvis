import type { Services } from '../../services';
import { logger } from '../../logging/logger';
import type { DictationRepo } from '../../voice/dictation';
import type { ModelStore } from '../../voice/local/model-store';
import { listAudioDevices } from '../../voice/providers';
import type { VoiceController } from '../../voice/voice-controller';
import type { VoiceStatus } from '@shared/ipc-contract';
import type { VoiceCheckResult } from '../../voice/v2/check';
import { V2_SETUP_MODELS } from '../../voice/v2/policy';
import { handle, onSend } from '../handle';
import { ENROL_PHRASES, type Enrolment } from '../../voice/enrolment';

interface VoiceMatch {
  enrolment: Enrolment;
  enrolled(): boolean;
  wakeTrained(): boolean;
  forget(): void;
}

/** Phase 4 channels. Audio capture never happens in the renderer (ADR-007). */
export function registerVoiceHandlers(
  s: Services,
  voice: VoiceController,
  ui: {
    setActiveConversation(id: string | null): void;
    isTest: boolean;
    mic: { status(): VoiceStatus; retry(): void; useDevice(deviceId: string): void };
    check(): Promise<VoiceCheckResult>;
  },
  local: { models: ModelStore; changed(): void },
  dictations: DictationRepo,
  match: VoiceMatch,
): void {
  const { models } = local;
  handle('dictation:history', () => dictations.list(100));
  handle('dictation:clear', () => {
    dictations.clear();
    return { ok: true };
  });
  handle('voice:setMode', async (req) => {
    const previous = s.settings.get('voice.mode');
    s.settings.set('voice.mode', req.mode); // the settings listener also re-applies the mode
    const r = await voice.applyMode();
    if (!r.ok) s.settings.set('voice.mode', previous === req.mode ? 'off' : previous);
    return r;
  });
  handle('voice:profile', () => ({
    enrolled: match.enrolled(),
    wakeTrained: match.wakeTrained(),
    phrases: match.enrolment.count(),
    needed: ENROL_PHRASES,
  }));
  handle('voice:enrol', async (req) => {
    switch (req.action) {
      case 'sample': {
        const r = await match.enrolment.sample();
        return { ok: true as const, count: r.count, heard: r.heard };
      }
      case 'finish': {
        const r = match.enrolment.finish();
        s.audit.append('user', 'voice.enrol', {
          phrases: ENROL_PHRASES,
          threshold: r.threshold,
          wakeWord: r.wakeWord,
          spotterLevel: r.spotterLevel,
        });
        return { ok: true as const, ...r };
      }
      case 'cancel':
        match.enrolment.cancel();
        return { ok: true as const };
      case 'delete':
        match.forget();
        s.audit.append('user', 'voice.enrolDelete', {});
        return { ok: true as const };
    }
  });
  handle('voice:mic', (req) => {
    if (req.action === 'retry') ui.mic.retry();
    else voice.mic(req.action);
    return { ok: true };
  });
  handle('voice:status', () => ui.mic.status());
  handle('voice:check', () => ui.check());
  handle('voice:captureDevice', (req) => {
    s.audit.append('user', 'voice.captureDevice', {});
    ui.mic.useDevice(req.deviceId);
    return { ok: true };
  });
  handle('voice:compose', (req) => {
    voice.compose(req.action);
    return { ok: true };
  });
  handle('voice:setupLocal', () => {
    s.audit.append('user', 'voice.setupLocal', {});
    void (async () => {
      // Voice v2's set (voice/v2/policy.ts): voice detector, speech model, both wake words.
      for (const id of V2_SETUP_MODELS) if (!models.installed(id)) await models.download(id);
      s.settings.set('voice.stt.whisperModel', 'moonshine-base'); // fastest accurate one (voice v2 bench)
      s.settings.set('voice.stt.provider', 'whisper');
      // ADR-044: the instant wake word replaces the slower Whisper name spotting.
      if (s.settings.get('voice.wake.provider') === 'name')
        s.settings.set('voice.wake.provider', 'spotter');
      local.changed();
      s.emit('notify', {
        level: 'info',
        message: 'On-device speech is ready. Tap the mic and talk.',
      });
    })().catch((err: unknown) => {
      logger.warn({ err: String(err) }, 'local speech setup failed');
      s.emit('notify', {
        level: 'error',
        message: 'The speech model download failed. Check the internet connection and try again.',
        action: 'settings:voice',
      });
    });
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
