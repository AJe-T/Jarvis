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
import { createVoiceController, type VoiceFactories } from './voice-controller';

function realFactories(s: Services): VoiceFactories {
  return {
    recorder: (deviceIndex, frameLength) => createPvRecorder(deviceIndex, frameLength),
    wake: (key, sensitivity) => createPorcupine(key, sensitivity),
    stt: createDeepgramStt(() => s.secrets.get('deepgram')),
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
  const voice = createVoiceController({
    settings: s.settings,
    secret: (name) =>
      s.isTest && (name === 'deepgram' || name === 'picovoice') ? 'test-key' : s.secrets.get(name),
    state: s.state,
    orchestrator: s.orchestrator,
    broker: s.broker,
    killSwitch: s.killSwitch,
    emit: s.emit,
    logger,
    factories: opts.factories ?? (s.isTest ? testFactories() : realFactories(s)),
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
    if (key === 'voice.mode' || key === 'voice.wake.sensitivity' || key === 'voice.deviceIndex')
      void voice.applyMode();
  });
  return {
    voice,
    setActiveConversation: (id: string | null) => {
      activeConversation = id;
    },
    start: () => voice.applyMode(),
  };
}
