import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDefaultName } from '@shared/assistant-name';
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
  listAudioDevices,
} from './providers';

/** The capture window's echo-cancelled microphone (windows/capture-window.ts). */
export interface MicCapture {
  recorder(
    device: { label: string; id: string; noiseSuppression?: boolean; autoGainControl?: boolean },
    frameLength: number,
    hooks?: {
      onDrop?(reason: 'queue' | 'length'): void;
      onStarted?(info: CaptureStarted): void;
    },
  ): Recorder;
  broken(): boolean;
  onBroken(listener: (why: string) => void): void;
  reset(): void;
}

/** Tells `onStop` when the controller closes this recorder (the mic status shows it closed). */
function onStopped(rec: Recorder, onStop: () => void): Recorder {
  return {
    frameLength: rec.frameLength,
    start: () => rec.start(),
    stop: () => {
      rec.stop();
      onStop();
    },
    read: () => rec.read(),
    release: () => rec.release(),
    get isRecording() {
      return rec.isRecording;
    },
  };
}
import { pickModel } from '../agent/model-router';
import { INTENT_JUDGE_PROMPT, parseIntent, type Intent, type JudgeContext } from './conversation';
import { createDictationRepo, finishDictation } from './dictation';
import { createLocalEngines, type LocalEngines } from './local/local-engines';
import { createModelStore, type ModelStore } from './local/model-store';
import { matchQuickCommand, type RoutineTriggers } from './quick-commands';
import type { Recorder, SttProvider } from './types';
import { createVoiceController, type VoiceFactories } from './voice-controller';
import { clearSpeechCache } from './tts-pipeline';
import { createEngineReporter, hearingChain, whyOf, type EngineReport } from './backup';
import { decodeAudio } from './audio-decode';
import { createVoiceDiagnostics, type VoiceDiagnostics } from './diagnostics';
import { createAudioWorker, utilityLink } from './audio-worker/client';
import { createMicSupervisor, type CaptureStarted, type MicSupervisor } from './mic-supervisor';
import { createElevenLabsTts } from './tts/elevenlabs';
import { createKokoroTts } from './tts/kokoro';
import { createAuraTts, createGroqTts, createOpenAiTts, createServerTts } from './tts/cloud-tts';
import { createPiperTts } from './tts/piper';
import { createAuraStreamTts, createElevenLabsStreamTts, streamFirst } from './tts/stream-tts';
import {
  assemblyAiTranscriber,
  elevenLabsTranscriber,
  groqTranscriber,
  openAiTranscriber,
  serverTranscriber,
  windowsTranscriber,
} from './stt/cloud-stt';
import type { Transcriber } from './local/whisper';
import { STT_ENGINES, type SttEngineId, type WakeEngineId } from '@shared/speech-engines';
import { inference } from '../inference/client';
import { createEnrolment } from './enrolment';
import { cosine, decodeProfile } from './local/speaker';
import { decodeTemplates, encodeTemplates } from './local/personal-wake';

/** ADR-039: Sir's voice fingerprint, encrypted with the other secrets; never shown or sent. */
export const VOICE_PROFILE_SECRET = 'voice_profile';
/** ADR-043: his recorded "Hey <name>" as wake-word templates; also his voice, so a secret too. */
export const WAKE_TEMPLATES_SECRET = 'voice_wake';
/** How often a Voice Match rejection is explained (the log keeps every one). */
const VOICE_MATCH_NOTICE_MS = 2 * 60_000;

/**
 * Voice Match check for one phrase. True when it is off, not set up or its model was removed, so
 * it can only narrow who wakes Jarvis by name, never stop press-to-talk.
 */
function createSpeakerCheck(s: Services, models: ModelStore) {
  let cached: { raw: string; centroid: Float32Array } | null = null;
  let lastNotice = 0;
  return async (audio: Float32Array): Promise<boolean> => {
    if (!s.settings.get('voice.speaker.verify')) return true;
    const raw = s.secrets.get(VOICE_PROFILE_SECRET);
    if (!raw || !models.installed('wavlm-speaker')) return true;
    if (cached?.raw !== raw) cached = { raw, centroid: decodeProfile(raw).centroid };
    const embedding = await inference().speakerEmbed({ dir: models.dir('wavlm-speaker'), audio });
    const score = Math.round(cosine(embedding, cached.centroid) * 100) / 100;
    const threshold = s.settings.get('voice.speaker.threshold');
    if (score >= threshold) return true;
    logger.info({ score, threshold }, 'voice match rejected');
    // A rejected wake was silent, so Sir just kept repeating the name: say why, now and then.
    if (Date.now() - lastNotice > VOICE_MATCH_NOTICE_MS) {
      lastNotice = Date.now();
      s.emit('notify', {
        level: 'warn',
        message: `I heard my name but Voice Match didn't recognise the voice (match ${score.toFixed(2)}, needs ${threshold.toFixed(2)}). Lower the match level or record your voice again in Settings → Voice.`,
        action: 'settings:voice',
      });
    }
    return false;
  };
}

type PhraseEngine = Exclude<SttEngineId, 'whisper' | 'deepgram'>;

/** ADR-038: engines that hear a whole phrase (after the on-device voice detector), by setting id. */
function phraseTranscribers(s: Services): Record<PhraseEngine, Transcriber> {
  const f = s.fetch ? { fetch: s.fetch } : {};
  return {
    groq: groqTranscriber({
      key: () => s.secrets.get('groq'),
      model: () => s.settings.get('voice.stt.groqModel'),
      ...f,
    }),
    openai: openAiTranscriber({
      key: () => s.secrets.get('openai'),
      model: () => s.settings.get('voice.stt.openaiModel'),
      ...f,
    }),
    elevenlabs: elevenLabsTranscriber({ key: () => s.secrets.get('elevenlabs'), ...f }),
    assemblyai: assemblyAiTranscriber({ key: () => s.secrets.get('assemblyai'), ...f }),
    server: serverTranscriber({
      url: () => s.settings.get('voice.stt.serverUrl'),
      key: () => s.secrets.get('speech_server'),
      model: () => s.settings.get('voice.stt.serverModel'),
      ...f,
    }),
    windows: windowsTranscriber(),
  };
}

/** A cloud phrase that fails (limit, network, server off) is read on this PC instead, when it can be. */
export function withLocalFallback(
  t: Transcriber,
  local: LocalEngines,
  report?: { name: string; to: EngineReport },
): Transcriber {
  return {
    async transcribe(audio, language) {
      try {
        const text = await t.transcribe(audio, language);
        report?.to('hearing', report.name);
        return text;
      } catch (err) {
        if (!local.ready()) throw err;
        logger.warn({ err: String(err) }, 'phrase engine failed; using on-device speech');
        const text = await local.transcribe(audio, language ?? 'auto');
        report?.to('hearing', LOCAL_HEARING, `${report.name}: ${whyOf(err)}`);
        return text;
      }
    },
    release: () => t.release(),
  };
}

const LOCAL_HEARING = 'Whisper on this PC';
const sttName = (id: SttEngineId): string =>
  id === 'groq' ? 'Groq Whisper' : (STT_ENGINES.find((e) => e.id === id)?.title ?? id);

/** The chosen engine has the key it needs (on-device engines and own servers need none). */
function hasKey(s: Services, id: SttEngineId): boolean {
  const info = STT_ENGINES.find((e) => e.id === id);
  return !info?.key || id === 'server' || !!s.secrets.get(info.key);
}

/** Why the engine really listening differs from the chosen one ('' when it doesn't). */
function fallbackWhy(chosen: SttEngineId, engine: SttEngineId): string {
  if (chosen === engine) return '';
  const info = STT_ENGINES.find((e) => e.id === chosen);
  return `${sttName(chosen)} is chosen but has no ${info?.keyLabel ?? 'key'}, so ${LOCAL_HEARING} is listening instead. Add the key in Settings → Voice to use ${sttName(chosen)}.`;
}

/** The engine that will really hear Sir: a cloud engine without its key falls back to on-device speech. */
function effectiveStt(s: Services, local: Pick<LocalEngines, 'ready'>): SttEngineId {
  const chosen = s.settings.get('voice.stt.provider');
  return chosen !== 'whisper' && !hasKey(s, chosen) && local.ready() ? 'whisper' : chosen;
}

/** ADR-011: wake word and speech-to-text engines are chosen separately in Settings → Voice. */
export function realFactories(
  s: Services,
  local: LocalEngines,
  models: ModelStore,
  capture?: MicCapture,
  extras: { diag?: VoiceDiagnostics; mic?: MicSupervisor } = {},
): VoiceFactories {
  const { diag, mic } = extras;
  const showHearing = (engine: SttEngineId): void => {
    const chosen = s.settings.get('voice.stt.provider');
    mic?.hearing({
      chosen: sttName(chosen),
      engine: sttName(engine),
      why: fallbackWhy(chosen, engine),
    });
  };
  const captureOn = (): boolean =>
    !!capture && s.settings.get('voice.echoCancel') && !capture.broken();
  const deepgram = createDeepgramStt(() => s.secrets.get('deepgram'));
  const phrase = phraseTranscribers(s);
  const report = createEngineReporter({ engines: s.voiceEngines, emit: s.emit });
  /**
   * AI Router Phase 3: cloud hearing behind on-device Whisper, only when Sir switched it on
   * (it sends his recorded voice to Groq / OpenAI) and only engines whose key is set.
   */
  const cloudHearing = (): Array<{ name: string; t: Transcriber }> =>
    s.settings.get('pool.abilities.voiceHearing')
      ? (['groq', 'openai'] as const)
          .filter((id) => hasKey(s, id))
          .map((id) => ({ name: sttName(id), t: phrase[id] }))
      : [];
  const stt: SttProvider = {
    id: 'selected',
    start: async (o) => {
      // A cloud engine chosen but no key: fall back to free on-device speech when it is downloaded.
      const engine = effectiveStt(s, local);
      showHearing(engine);
      if (engine === 'whisper') {
        const cloud = cloudHearing();
        if (cloud.length && local.vadReady()) {
          // chisle: phrase mode (no live partials) while cloud hearing is on; keeps uploads to whole phrases.
          const onDevice: Transcriber = {
            transcribe: (audio, language) => local.transcribe(audio, language ?? 'auto'),
            release: async () => undefined,
          };
          return local
            .phraseStt(
              'whisper',
              hearingChain([{ name: LOCAL_HEARING, t: onDevice }, ...cloud], report),
            )
            .start(o);
        }
        report('hearing', LOCAL_HEARING);
        return local.stt.start(o);
      }
      const info = STT_ENGINES.find((e) => e.id === engine);
      if (!hasKey(s, engine))
        throw new JarvisError(
          'INVALID',
          'no speech engine',
          `Speech needs a one-time setup: Settings → Voice → "Set up free on-device speech" (about 100 MB, works offline), or add a ${info?.keyLabel ?? 'key'}.`,
        );
      if (engine === 'deepgram') {
        report('hearing', sttName('deepgram'));
        return deepgram.start(o);
      }
      if (!local.vadReady())
        throw new JarvisError(
          'INVALID',
          'voice detector not downloaded',
          `${info?.title ?? 'This engine'} needs the small voice detector (2 MB) to hear when you stop talking: Settings → Voice → Speech to text → Download.`,
        );
      return local
        .phraseStt(
          engine,
          withLocalFallback(phrase[engine], local, { name: sttName(engine), to: report }),
        )
        .start(o);
    },
  };
  return {
    // Echo-cancelled microphone from the capture window when on (and working); else the native one.
    recorder: (deviceIndex, frameLength) =>
      onStopped(
        captureOn()
          ? (capture as MicCapture).recorder(
              {
                label: listAudioDevices()[deviceIndex] ?? '',
                id: s.settings.get('voice.captureDeviceId'),
                noiseSuppression: s.settings.get('voice.capture.noiseSuppression'),
                autoGainControl: s.settings.get('voice.capture.autoGain'),
              },
              frameLength,
              {
                onDrop: (reason) => diag?.drop(reason),
                onStarted: (info) => mic?.started(info),
              },
            )
          : createPvRecorder(deviceIndex, frameLength, {
              onOverrun: (frames) => diag?.drop('overrun', frames),
              onStart: (device) => {
                logger.info({ device, deviceIndex }, 'native microphone started');
                mic?.nativeStarted(device);
              },
              debug: s.settings.get('voice.debugAudio'),
            }),
        () => mic?.stopped(),
      ),
    echoCancelled: captureOn,
    wake: (sensitivity) => {
      const engine = s.settings.get('voice.wake.provider');
      if (engine === 'spotter')
        return local.spotterWake(
          sensitivity,
          s.settings.get('assistant.name'),
          s.settings.get('voice.wake.learned'),
        );
      if (engine === 'personal') {
        const raw = s.secrets.get(WAKE_TEMPLATES_SECRET);
        if (!raw)
          throw new JarvisError(
            'INVALID',
            'no personal wake word',
            `Record your voice first: Settings → Voice → Your voice (say “Hey ${s.settings.get('assistant.name')}” five times).`,
          );
        return local.personalWake(
          sensitivity,
          decodeTemplates(raw),
          isDefaultName(s.settings.get('assistant.name')),
        );
      }
      if (engine === 'openwakeword') return local.wake(sensitivity);
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
    verifySpeaker: createSpeakerCheck(s, models),
    edge: createEdgeTts(),
    sapi: createSapiTts(),
    kokoro: createKokoroTts({
      modelDir: () => models.dir('kokoro-82m'),
      installed: () => models.installed('kokoro-82m'),
      voice: () => s.settings.get('voice.tts.kokoroVoice'),
    }),
    // Voice fix 2B: streamed PCM over a WebSocket first, the same voice over HTTP if that fails.
    elevenlabs: streamFirst(
      createElevenLabsStreamTts({
        key: () => s.secrets.get('elevenlabs'),
        voiceId: () => s.settings.get('voice.tts.elevenVoice'),
        model: () => s.settings.get('voice.tts.elevenModel'),
      }),
      createElevenLabsTts({
        key: () => s.secrets.get('elevenlabs'),
        voiceId: () => s.settings.get('voice.tts.elevenVoice'),
        model: () => s.settings.get('voice.tts.elevenModel'),
        ...(s.fetch ? { fetch: s.fetch } : {}),
      }),
    ),
    piper: createPiperTts({
      modelDir: (v) => models.dir(v),
      installed: (v) => models.installed(v),
      voice: () => s.settings.get('voice.tts.piperVoice'),
    }),
    openai: createOpenAiTts({
      key: () => s.secrets.get('openai'),
      model: () => s.settings.get('voice.tts.openaiModel'),
      voice: () => s.settings.get('voice.tts.openaiVoice'),
      style: () => s.settings.get('voice.tts.openaiStyle'),
      ...(s.fetch ? { fetch: s.fetch } : {}),
    }),
    aura: streamFirst(
      createAuraStreamTts({
        key: () => s.secrets.get('deepgram'),
        voice: () => s.settings.get('voice.tts.auraVoice'),
      }),
      createAuraTts({
        key: () => s.secrets.get('deepgram'),
        voice: () => s.settings.get('voice.tts.auraVoice'),
        ...(s.fetch ? { fetch: s.fetch } : {}),
      }),
    ),
    groq: createGroqTts({
      key: () => s.secrets.get('groq'),
      voice: () => s.settings.get('voice.tts.groqVoice'),
      ...(s.fetch ? { fetch: s.fetch } : {}),
    }),
    server: createServerTts({
      url: () => s.settings.get('voice.tts.serverUrl'),
      key: () => s.secrets.get('speech_server'),
      model: () => s.settings.get('voice.tts.serverModel'),
      voice: () => s.settings.get('voice.tts.serverVoice'),
      ...(s.fetch ? { fetch: s.fetch } : {}),
    }),
    // Always-listening and the wake word by name both run Whisper on this PC (no audio leaves it),
    // whichever speech-to-text engine answers the request itself.
    ambient: (handlers) => {
      if (!local.ready())
        throw new JarvisError(
          'INVALID',
          'whisper not downloaded',
          'Listening for a name needs the free on-device speech models: Settings → Voice → "Set up free on-device speech" (about 100 MB, once).',
        );
      return local.ambient(handlers);
    },
  };
}

/** ADR-012 intent judge: a small, fast model call on the recent transcript. */
function createJudge(s: Services) {
  return async (transcript: string, ctx: JudgeContext): Promise<Intent> => {
    s.budget.assertCanSpend();
    const model = pickModel(s.settings, { purpose: 'intent' });
    const msg = await s.llm.stream(
      {
        model,
        max_tokens: 300,
        system: isDefaultName(s.settings.get('assistant.name'))
          ? INTENT_JUDGE_PROMPT
          : `${INTENT_JUDGE_PROMPT}

Sir renamed the assistant: its name is now "${s.settings.get('assistant.name')}". Read every mention of Jarvis above as that name.`,
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
    judge?: (transcript: string, ctx: JudgeContext) => Promise<Intent>;
    /** The echo-cancelled microphone (absent in tests). */
    capture?: MicCapture;
  } = {},
) {
  let activeConversation: string | null = null;
  const diag = createVoiceDiagnostics({
    dir: join(s.userData, 'debug-audio'),
    enabled: () => s.settings.get('voice.debugAudio'),
    logger,
  });
  const mic = createMicSupervisor({
    ...(opts.capture ? { capture: opts.capture } : {}),
    echoCancel: () => s.settings.get('voice.echoCancel'),
    busy: () => voice.isListening() || s.state.get() === 'SPEAKING',
    restart: () => void voice.applyMode(),
    learnDevice: (id) => {
      if (s.settings.get('voice.captureDeviceId') !== id)
        s.settings.set('voice.captureDeviceId', id);
    },
    emit: (status) => s.emit('voice:status', status),
    notify: (level, message) => s.emit('notify', { level, message, action: 'settings:voice' }),
    logger,
  });
  const models: ModelStore = createModelStore({
    root: join(s.userData, 'models'),
    onProgress: (p) => s.emit('models:progress', p),
  });
  // Voice fix 1B: wake words and the voice detector run in their own utility process (the app only;
  // tests and plain Node keep them in this process).
  const audioHost = join(__dirname, 'audio-host.js');
  const worker =
    !s.isTest && process.versions['electron'] && existsSync(audioHost)
      ? createAudioWorker({ logger, connect: () => utilityLink(audioHost, logger) })
      : undefined;
  const local = createLocalEngines(models, s.settings, {
    ...(worker ? { worker } : {}),
    onWakeTiming: diag.timer('worker.wake'),
    onWakeBacklog: () => diag.drop('backlog'),
    onSlow: () => {
      logger.warn('speech recognition is slower than real time');
      s.emit('notify', {
        level: 'warn',
        message:
          'Speech recognition is running slower than you speak. Choose the smaller Whisper base.en in Settings → Voice for quicker replies.',
        action: 'settings:voice',
      });
    },
    // A "Hey Jarvis" that almost woke him: the log shows how close it came (tune the sensitivity).
    onNearMiss: (info) => logger.info(info, 'wake word near miss'),
    onSpotted: (info) => logger.info(info, 'wake word heard'),
    onSpotterDecode: diag.timer('spotter.decode'),
  });
  /** Phase 0: the voice setup actually in effect (keys only as present / absent). */
  function logVoiceSetup(reason: string): void {
    const chosen = s.settings.get('voice.stt.provider');
    const engine = effectiveStt(s, local);
    mic.hearing({
      chosen: sttName(chosen),
      engine: sttName(engine),
      why: fallbackWhy(chosen, engine),
    });
    const deviceIndex = s.settings.get('voice.deviceIndex');
    const echoCancel = s.settings.get('voice.echoCancel');
    logger.info(
      {
        reason,
        mode: s.settings.get('voice.mode'),
        sttProvider: s.settings.get('voice.stt.provider'),
        sttEffective: effectiveStt(s, local),
        wakeProvider: s.settings.get('voice.wake.provider'),
        echoCancel,
        echoCancelActive: echoCancel && !!opts.capture && !opts.capture.broken(),
        deviceIndex,
        device: s.isTest ? '' : (listAudioDevices()[deviceIndex] ?? 'default'),
        deepgramKey: !!s.secrets.get('deepgram'),
        debugAudio: s.settings.get('voice.debugAudio'),
        audioWorker: !!worker,
      },
      'voice setup',
    );
  }
  /** After the personal wake word goes away: the instant spotter when downloaded (any name). */
  const fallbackWake = (): WakeEngineId =>
    local.spotterReady()
      ? 'spotter'
      : local.wakeReady() && isDefaultName(s.settings.get('assistant.name'))
        ? 'openwakeword'
        : 'name';
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
    ...(opts.judge
      ? { judge: opts.judge }
      : s.isTest
        ? {}
        : { judge: s.laya.gateJudge(createJudge(s)) }),
    orchestrator: s.orchestrator,
    broker: s.broker,
    killSwitch: s.killSwitch,
    emit: s.emit,
    report: createEngineReporter({ engines: s.voiceEngines, emit: s.emit }),
    logger,
    factories:
      opts.factories ??
      (s.isTest ? testFactories() : realFactories(s, local, models, opts.capture, { diag, mic })),
    diag,
    onEcho: (state) => mic.echo(state),
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
  const enrolment = createEnrolment({
    record: () => voice.recordSample(),
    speakerReady: () => models.installed('wavlm-speaker'),
    embed: (audio) => inference().speakerEmbed({ dir: models.dir('wavlm-speaker'), audio }),
    transcribe: (audio) =>
      local.ready()
        ? local.transcribe(audio, s.settings.get('voice.stt.language'))
        : Promise.resolve(''),
    wakeFeatures: (audio) => local.wakeFeatures(audio),
    spotterLevel: (audio) => local.spotterLevel(audio, s.settings.get('assistant.name')),
    endCalibration: () => local.endCalibration(),
    name: () => s.settings.get('assistant.name'),
    save: (profile, r) => {
      s.secrets.set(VOICE_PROFILE_SECRET, profile);
      s.settings.set('voice.speaker.threshold', r.threshold);
      s.settings.set('voice.wake.learned', r.aliases);
      s.settings.set('voice.wake.spotterLevel', r.spotterLevel);
      s.settings.set('voice.speaker.verify', true);
    },
    // ADR-043: the same five phrases become his wake word, used at once unless he chose Picovoice.
    saveWake: (templates) => {
      if (!templates) {
        if (s.secrets.get(WAKE_TEMPLATES_SECRET)) s.secrets.delete(WAKE_TEMPLATES_SECRET);
        if (s.settings.get('voice.wake.provider') === 'personal')
          s.settings.set('voice.wake.provider', fallbackWake());
        return;
      }
      s.secrets.set(WAKE_TEMPLATES_SECRET, encodeTemplates(templates));
      const engine = s.settings.get('voice.wake.provider');
      if (engine === 'personal') void voice.applyMode();
      // The spotter (ADR-044) stays: the recordings just calibrated it. Picovoice is Sir's pick.
      else if (engine !== 'picovoice' && engine !== 'spotter')
        s.settings.set('voice.wake.provider', 'personal');
    },
  });
  s.confirmShowListeners.add((e) => voice.onConfirmShown(e));
  // The echo-cancelled mic failed: start again on the native one, so the wake word keeps hearing Sir.
  // Voice fix 1A: the native mic takes over at once and the echo-cancelled one is retried (1 s, 3 s, 10 s).
  opts.capture?.onBroken((why) => mic.broken(why));
  s.killSwitch.onKill(() => voice.onKill());
  s.reminderListeners.add((text, missed) => {
    if (s.settings.get('voice.mode') !== 'off' && s.settings.get('quiet.until') <= Date.now())
      voice.notice(`Sir, ${missed ? 'you missed a reminder' : 'a reminder'}: ${text}`);
  });
  s.announceListeners.add((text) => {
    if (s.settings.get('voice.mode') !== 'off') voice.notice(text);
  });
  s.settings.onChange((key) => {
    // The learned Chromium id belonged to the old microphone.
    if (key === 'voice.deviceIndex' && s.settings.get('voice.captureDeviceId'))
      s.settings.set('voice.captureDeviceId', '');
    // Echo cancellation switched (back) on: give the capture window a fresh start.
    if (key === 'voice.echoCancel') mic.retry();
    // Voice fix 1C: the wake word was calibrated on the microphone as it sounded then.
    if (
      (key === 'voice.echoCancel' ||
        key === 'voice.capture.noiseSuppression' ||
        key === 'voice.capture.autoGain') &&
      (s.settings.get('voice.wake.spotterLevel') > 0 || s.secrets.get(WAKE_TEMPLATES_SECRET))
    )
      s.emit('notify', {
        level: 'info',
        message: `The microphone sounds different now. Record your voice again (Settings → Voice → Your voice) so “Hey ${s.settings.get('assistant.name')}” stays calibrated for it.`,
        action: 'settings:voice',
      });
    // Spellings learned for the old name would wake Jarvis on the wrong word.
    if (key === 'assistant.name' && s.settings.get('voice.wake.learned').length)
      s.settings.set('voice.wake.learned', []);
    // So is a spotter level calibrated on "Hey <old name>".
    if (key === 'assistant.name' && s.settings.get('voice.wake.spotterLevel') > 0)
      s.settings.set('voice.wake.spotterLevel', 0);
    // The recorded "Hey <old name>" would only answer to the old name.
    if (key === 'assistant.name' && s.secrets.get(WAKE_TEMPLATES_SECRET)) {
      s.secrets.delete(WAKE_TEMPLATES_SECRET);
      if (s.settings.get('voice.wake.provider') === 'personal') {
        s.settings.set('voice.wake.provider', local.spotterReady() ? 'spotter' : 'name');
        s.emit('notify', {
          level: 'info',
          message: `New name: record your voice again (Settings → Voice → Your voice) so “Hey ${s.settings.get('assistant.name')}” wakes me instantly.`,
          action: 'settings:voice',
        });
      }
    }
    if (
      key === 'voice.mode' ||
      key === 'voice.wake.sensitivity' ||
      key === 'voice.wake.provider' ||
      key === 'voice.wake.spotterLevel' ||
      key === 'voice.wake.learned' ||
      key === 'voice.stt.provider' ||
      key === 'voice.stt.whisperModel' ||
      key === 'voice.deviceIndex' ||
      key === 'voice.echoCancel' ||
      key === 'voice.debugAudio' || // closes open recordings, restarts the mic with debug output
      key === 'voice.capture.noiseSuppression' ||
      key === 'voice.capture.autoGain' ||
      key === 'assistant.name'
    )
      // A wake word that can't start must say so (it used to fail silently and simply never hear Sir).
      void voice.applyMode().then((r) => {
        logVoiceSetup(key);
        if (!r.ok && r.error && key !== 'voice.mode')
          // voice:setMode shows its own error
          s.emit('notify', { level: 'warn', message: r.error, action: 'settings:voice' });
      });
    if (key === 'voice.stt.provider' || key === 'voice.stt.whisperModel') local.preload();
    if (key.startsWith('voice.tts.')) {
      clearSpeechCache();
      voice.warmLines();
    }
  });
  const edge = createEdgeTts();
  const clipTranscribers = phraseTranscribers(s);
  return {
    voice,
    dictations,
    /**
     * A recorded clip (Telegram voice note) → text. Deepgram reads OGG directly when there's a key;
     * otherwise on-device Whisper (the renderer decodes the audio first). Null if neither is set up.
     */
    async transcribeClip(data: Uint8Array, mime: string): Promise<string | null> {
      const chosen = s.settings.get('voice.stt.provider');
      const lang = s.settings.get('voice.stt.language');
      if (chosen !== 'whisper' && chosen !== 'deepgram' && hasKey(s, chosen)) {
        const samples = await decodeAudio(data, mime);
        return withLocalFallback(clipTranscribers[chosen], local).transcribe(
          samples.slice(0, 16000 * 120),
          lang,
        );
      }
      const key = s.secrets.get('deepgram');
      const useWhisper = chosen !== 'deepgram' || !key;
      if (useWhisper) {
        if (!local.ready()) return null;
        const samples = await decodeAudio(data, mime);
        return local.transcribe(
          samples.slice(0, 16000 * 120),
          s.settings.get('voice.stt.language'),
        );
      }
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
    /** ADR-039 Voice Match: enrolment and the saved profile. */
    voiceMatch: {
      enrolment,
      enrolled: (): boolean => !!s.secrets.get(VOICE_PROFILE_SECRET),
      wakeTrained: (): boolean => !!s.secrets.get(WAKE_TEMPLATES_SECRET),
      forget(): void {
        enrolment.cancel();
        if (s.secrets.get(VOICE_PROFILE_SECRET)) s.secrets.delete(VOICE_PROFILE_SECRET);
        if (s.secrets.get(WAKE_TEMPLATES_SECRET)) s.secrets.delete(WAKE_TEMPLATES_SECRET);
        s.settings.set('voice.speaker.verify', false);
        s.settings.set('voice.wake.learned', []);
        s.settings.set('voice.wake.spotterLevel', 0);
        if (s.settings.get('voice.wake.provider') === 'personal')
          s.settings.set('voice.wake.provider', fallbackWake());
      },
    },
    local: {
      models,
      /** A model was downloaded: warm Whisper and Laya, and (re)start the wake word if it was waiting for it. */
      changed: () => {
        local.preload();
        s.laya.warm();
        void voice.applyMode();
      },
    },
    /** Voice fix 1A: the microphone in use, Try again, and picking the echo-cancelled mic's device. */
    mic: {
      status: () => mic.status(),
      retry: () => mic.retry(),
      useDevice: (deviceId: string) => mic.useDevice(deviceId),
    },
    setActiveConversation: (id: string | null) => {
      activeConversation = id;
    },
    start: () => {
      if (!s.isTest) local.preload();
      // Debug recordings are Sir's voice: kept only while he has them switched on.
      if (!s.settings.get('voice.debugAudio'))
        void diag.clear().catch((err: unknown) => {
          logger.warn({ err: String(err) }, 'old debug recordings could not be deleted');
        });
      logVoiceSetup('start');
      // Voice Match on: load its model now, so the first "Hey Jarvis" isn't slowed by it.
      if (!s.isTest && s.settings.get('voice.speaker.verify') && models.installed('wavlm-speaker'))
        void inference()
          .speakerEmbed({ dir: models.dir('wavlm-speaker'), audio: new Float32Array(8000) })
          .catch(() => undefined);
      return voice.applyMode();
    },
  };
}
