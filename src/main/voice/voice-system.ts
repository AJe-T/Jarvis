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
import { pickModel } from '../agent/model-router';
import { INTENT_JUDGE_PROMPT, parseIntent, type Intent } from './conversation';
import { createDictationRepo, finishDictation } from './dictation';
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
    ambient: (handlers) => {
      if (s.settings.get('voice.stt.provider') !== 'whisper')
        throw new JarvisError(
          'INVALID',
          'ambient needs whisper',
          'Always-listening mode only runs with on-device Whisper (Settings → Voice → Speech to text), so no audio leaves this PC.',
        );
      return local.ambient(handlers);
    },
  };
}

/** ADR-012 intent judge: a small, fast model call on the recent transcript. */
function createJudge(s: Services) {
  return async (
    transcript: string,
    ctx: { followUp: boolean; lastReply: string },
  ): Promise<Intent> => {
    s.budget.assertCanSpend();
    const model = pickModel(s.settings, { purpose: 'intent' });
    const msg = await s.llm.stream(
      {
        model,
        max_tokens: 300,
        system: INTENT_JUDGE_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Follow-up window open: ${ctx.followUp ? 'yes' : 'no'}
Jarvis last said: ${ctx.lastReply || '(nothing recently)'}

Transcript (oldest first):
${transcript}`,
          },
        ],
      },
      { signal: AbortSignal.timeout(15_000) },
    );
    s.ledger.record(msg, 'intent', null);
    return parseIntent(msg.content.map((b) => (b.type === 'text' ? b.text : '')).join(''));
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
    timeouts?: { silenceMs?: number; maxListenMs?: number; echoSettleMs?: number };
    /** Tests: a scripted intent judge. */
    judge?: (transcript: string, ctx: { followUp: boolean; lastReply: string }) => Promise<Intent>;
  } = {},
) {
  let activeConversation: string | null = null;
  const models: ModelStore = createModelStore({
    root: join(s.userData, 'models'),
    onProgress: (p) => s.emit('models:progress', p),
  });
  const local = createLocalEngines(models, s.settings);
  const dictations = createDictationRepo(s.db);
  /** Types dictated words into the app in front (clipboard + Ctrl+V, clipboard restored). */
  async function typeDictation(raw: string): Promise<void> {
    const text = finishDictation(raw, {
      removeFillers: s.settings.get('dictation.removeFillers'),
      dictionary: s.settings.get('dictation.dictionary'),
    });
    if (!text) return;
    const target = await s.os.foregroundWindow().catch(() => ({ title: '', process: '' }));
    await s.os.pasteText(text);
    if (s.settings.get('dictation.keepHistory'))
      dictations.add(raw, text, target.process || target.title || null);
    s.emit('dictation:done', { text, app: target.process || target.title || '' });
  }
  const voice = createVoiceController({
    settings: s.settings,
    state: s.state,
    ...(opts.judge ? { judge: opts.judge } : s.isTest ? {} : { judge: createJudge(s) }),
    orchestrator: s.orchestrator,
    broker: s.broker,
    killSwitch: s.killSwitch,
    emit: s.emit,
    logger,
    factories: opts.factories ?? (s.isTest ? testFactories() : realFactories(s, local)),
    activeConversation: () => activeConversation ?? undefined,
    onDictation: (text) =>
      void typeDictation(text).catch((err: unknown) => {
        logger.warn({ err: String(err) }, 'dictation paste failed');
        s.emit('notify', {
          level: 'error',
          message: "Couldn't type the dictation; it's in Settings → Voice → Dictation history.",
        });
        dictations.add(text, text, null);
      }),
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
      key === 'voice.stt.provider' ||
      key === 'voice.deviceIndex'
    )
      void voice.applyMode();
    if (key === 'voice.stt.provider' || key === 'voice.stt.whisperModel') local.preload();
  });
  return {
    voice,
    dictations,
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
