import { join } from 'node:path';
import { JarvisError } from '../errors';
import { logger } from '../logging/logger';
import type { Services } from '../services';
import { createFakeRecorder, createFakeStt, createFakeTts, createFakeWake } from './fakes';
import {
  createDeepgramStt,
  createEdgeTts,
  createPorcupine,
  createPvRecorder,
  createSapiTts,
} from './providers';
import { createLocalEngines, type LocalEngines } from './local/local-engines';
import { createModelStore, type ModelStore } from './local/model-store';
import type { SttProvider } from './types';
import { createVoiceController, type VoiceFactories } from './voice-controller';

/** ADR-011: wake word and speech-to-text engines are chosen separately in Settings → Voice. */
export function realFactories(s: Services, local: LocalEngines): VoiceFactories {
  const deepgram = createDeepgramStt(() => s.secrets.get('deepgram'));
  const stt: SttProvider = {
    id: 'selected',
    start: (o) =>
      (s.settings.get('voice.stt.provider') === 'whisper' ? local.stt : deepgram).start(o),
  };
  return {
    recorder: (deviceIndex, frameLength) => createPvRecorder(deviceIndex, frameLength),
    wake: (sensitivity) => {
      if (s.settings.get('voice.wake.provider') === 'openwakeword') return local.wake(sensitivity);
      const key = s.secrets.get('picovoice');
      if (!key)
        throw new JarvisError(
          'INVALID',
          'no picovoice key',
          'Add a Picovoice AccessKey, or choose the on-device "Hey Jarvis" wake word, in Settings → Voice.',
        );
      return createPorcupine(key, sensitivity);
    },
    stt,
    edge: createEdgeTts(),
    sapi: createSapiTts(),
  };
}

/** JARVIS_TEST=1: no microphone, network or keys; JARVIS_FAKE_TRANSCRIPTS="a|b" feeds the fake STT. */
function testFactories(): VoiceFactories {
  const transcripts = (process.env['JARVIS_FAKE_TRANSCRIPTS'] ?? '').split('|').filter(Boolean);
  return {
    recorder: (_i, frameLength) => createFakeRecorder(frameLength),
    wake: () => createFakeWake(),
    stt: createFakeStt(transcripts),
    edge: createFakeTts('edge'),
    sapi: createFakeTts('sapi'),
  };
}

/** Phase 4 composition: voice controller + its hooks into confirmations, reminders and the kill switch. */
export function createVoiceSystem(
  s: Services,
  opts: {
    factories?: VoiceFactories;
    timeouts?: { silenceMs?: number; maxListenMs?: number };
  } = {},
) {
  let activeConversation: string | null = null;
  const models: ModelStore = createModelStore({
    root: join(s.userData, 'models'),
    onProgress: (p) => s.emit('models:progress', p),
  });
  const local = createLocalEngines(models, s.settings);
  const voice = createVoiceController({
    settings: s.settings,
    state: s.state,
    orchestrator: s.orchestrator,
    broker: s.broker,
    killSwitch: s.killSwitch,
    emit: s.emit,
    logger,
    factories: opts.factories ?? (s.isTest ? testFactories() : realFactories(s, local)),
    activeConversation: () => activeConversation ?? undefined,
    ...(opts.timeouts ? { timeouts: opts.timeouts } : {}),
  });
  s.confirmShowListeners.add((e) => voice.onConfirmShown(e));
  s.killSwitch.onKill(() => voice.onKill());
  s.reminderListeners.add((text, missed) => {
    if (s.settings.get('voice.mode') !== 'off')
      voice.say(`Sir, ${missed ? 'you missed a reminder' : 'a reminder'}: ${text}`);
  });
  s.settings.onChange((key) => {
    if (
      key === 'voice.mode' ||
      key === 'voice.wake.sensitivity' ||
      key === 'voice.wake.provider' ||
      key === 'voice.deviceIndex'
    )
      void voice.applyMode();
    if (key === 'voice.stt.provider' || key === 'voice.stt.whisperModel') local.preload();
  });
  return {
    voice,
    local: {
      models,
      /** A model was downloaded: warm Whisper and (re)start the wake word if it was waiting for it. */
      changed: () => {
        local.preload();
        void voice.applyMode();
      },
    },
    setActiveConversation: (id: string | null) => {
      activeConversation = id;
    },
    start: () => {
      if (!s.isTest) local.preload();
      return voice.applyMode();
    },
  };
}
