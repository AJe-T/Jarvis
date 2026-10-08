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
import { matchQuickCommand, type RoutineTriggers } from './quick-commands';
import type { SttProvider } from './types';
import { createVoiceController, type VoiceFactories } from './voice-controller';
import { decodeAudio } from './audio-decode';

/** ADR-011: wake word and speech-to-text engines are chosen separately in Settings → Voice. */
export function realFactories(s: Services, local: LocalEngines): VoiceFactories {
  const deepgram = createDeepgramStt(() => s.secrets.get('deepgram'));
  const stt: SttProvider = {
    id: 'selected',
    start: async (o) => {
      // Deepgram chosen but no key: fall back to free on-device Whisper when it is downloaded.
      const whisper =
        s.settings.get('voice.stt.provider') === 'whisper' ||
        (!s.secrets.get('deepgram') && local.ready());
      if (!whisper && !s.secrets.get('deepgram'))
        throw new JarvisError(
          'INVALID',
          'no speech engine',
          'Speech needs a one-time setup: Settings → Voice → "Set up free on-device speech" (about 80 MB, works offline), or add a Deepgram key.',
        );
      return (whisper ? local.stt : deepgram).start(o);
    },
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
    timeouts?: {
      silenceMs?: number;
      maxListenMs?: number;
      echoSettleMs?: number;
      dictationQuietMs?: number;
      composeIdleMs?: number;
    };
    /** Tests: a scripted intent judge. */
    judge?: (transcript: string, ctx: { followUp: boolean; lastReply: string }) => Promise<Intent>;
  } = {},
) {
  let activeConversation: string | null = null;
  const models: ModelStore = createModelStore({
    root: join(s.userData, 'models'),
    onProgress: (p) => s.emit('models:progress', p),
  });
  const local = createLocalEngines(models, s.settings, {
    onSlow: () => {
      logger.warn('speech recognition is slower than real time');
      s.emit('notify', {
        level: 'warn',
        message:
          'Speech recognition is running slower than you speak. Choose the smaller Whisper base.en in Settings → Voice for quicker replies.',
        action: 'settings:voice',
      });
    },
  });
  const dictations = createDictationRepo(s.db);
  const routineTriggers = (): RoutineTriggers[] =>
    (
      s.db
        .prepare('SELECT name, trigger_phrases_json FROM routines WHERE enabled = 1')
        .all() as Array<{ name: string; trigger_phrases_json: string }>
    ).map((r) => ({ name: r.name, triggers: JSON.parse(r.trigger_phrases_json) as string[] }));
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
    quick: (text) => matchQuickCommand(text, routineTriggers()),
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
  const edge = createEdgeTts();
  return {
    voice,
    dictations,
    /**
     * A recorded clip (Telegram voice note) → text. Deepgram reads OGG directly when there's a key;
     * otherwise on-device Whisper (the renderer decodes the audio first). Null if neither is set up.
     */
    async transcribeClip(data: Uint8Array, mime: string): Promise<string | null> {
      const key = s.secrets.get('deepgram');
      const useWhisper = s.settings.get('voice.stt.provider') === 'whisper' || !key;
      if (useWhisper) {
        if (!local.ready()) return null;
        const samples = await decodeAudio(data, mime);
        return local.transcribe(
          samples.slice(0, 16000 * 120),
          s.settings.get('voice.stt.language'),
        );
      }
      const lang = s.settings.get('voice.stt.language');
      const url = `https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=${encodeURIComponent(lang === 'auto' ? 'multi' : lang)}`;
      const res = await (s.fetch ?? fetch)(url, {
        method: 'POST',
        headers: { authorization: `Token ${key}`, 'content-type': mime },
        body: Buffer.from(data),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Deepgram: HTTP ${res.status}`);
      const j = (await res.json()) as {
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
      };
      return j.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
    },
    /** Text → MP3 in Jarvis's voice (Edge), for voice replies on Telegram. */
    async speakMp3(text: string): Promise<Uint8Array> {
      const parts: Uint8Array[] = [];
      for await (const c of edge.synthesize(text, {
        voice: s.settings.get('voice.tts.voice'),
        rate: s.settings.get('voice.tts.rate'),
        signal: AbortSignal.timeout(60_000),
      }))
        parts.push(c.data);
      return Buffer.concat(parts);
    },
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
