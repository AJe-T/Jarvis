import { join } from 'node:path';
import { LOCAL_STT_MODELS } from '@shared/speech-engines';
import { JarvisError } from '../../errors';
import type { SettingsService } from '../../settings/settings-service';
import type { SttProvider, WakeWord } from '../types';
import {
  createContinuousTranscriber,
  type ContinuousTranscriber,
  type HeardSegment,
} from './continuous';
import { createWhisperStt } from './local-stt';
import type { ModelId, ModelStore } from './model-store';
import { loadOwwModels, loadSileroVad, type Vad } from './onnx';
import { createOpenWakeWord, thresholdFor, type OwwModels } from './open-wake-word';
import {
  createCalibrator,
  createSpotterWake,
  keywordsText,
  loadSpotterModel,
  spotterThreshold,
  wakePhrases,
  type KeywordEngine,
  type SpotterModel,
} from './spotter';
import {
  createPersonalWake,
  phraseFeatures,
  type PhraseFeatures,
  type WakeTemplates,
} from './personal-wake';

const round2 = (n: number): number => Math.round(n * 100) / 100;
import type { Transcriber } from './whisper';
import { inference } from '../../inference/client';
import type { AudioWorker } from '../audio-worker/client';

/** Whisper in the model process (ADR-029); resolves once the model is loaded there. */
async function isolatedWhisper(dir: string, multilingual: boolean): Promise<Transcriber> {
  const ops = inference();
  await ops.whisperWarm({ dir, multilingual });
  return {
    transcribe: (audio, language) =>
      ops.transcribe({ dir, multilingual, audio, ...(language ? { language } : {}) }),
    release: () => ops.whisperRelease({ dir }),
  };
}

const notReady = (what: string): JarvisError =>
  new JarvisError(
    'INVALID',
    `${what} not downloaded`,
    `Download the ${what} in Settings → Voice first.`,
  );

/** Phrases in a row that decoded slower than they were spoken before Sir is told (isair/jarvis idea). */
const SLOW_STREAK = 3;

/** Wraps Whisper to notice when it can't keep up with speech (once per run). */
export function watchSpeed(t: Transcriber, onSlow: () => void, now = Date.now): Transcriber {
  let streak = 0;
  let warned = false;
  return {
    async transcribe(audio, language) {
      const start = now();
      const text = await t.transcribe(audio, language);
      const spokenMs = (audio.length / 16000) * 1000;
      if (spokenMs >= 1000) streak = now() - start > spokenMs ? streak + 1 : 0;
      if (streak >= SLOW_STREAK && !warned) {
        warned = true;
        onSlow();
      }
      return text;
    },
    release: () => t.release(),
  };
}

/**
 * ADR-011/044: the on-device wake words (spotter, openWakeWord, personal), the Silero voice detector
 * and Whisper. Wake words and the detector run in the audio worker when there is one (voice fix 1B),
 * Whisper in the inference host. Models load once and stay warm.
 */
export function createLocalEngines(
  store: ModelStore,
  settings: SettingsService,
  hooks: {
    onSlow?(): void;
    onNearMiss?(info: Record<string, unknown>): void;
    onSpotted?(info: Record<string, unknown>): void;
    /** Phase 0: how long each keyword-spotter decode took (when it runs in main, without a worker). */
    onSpotterDecode?(ms: number): void;
    /**
     * Voice fix 1B: the audio worker that runs the wake words and the voice detector off the main
     * process. Absent in tests and plain Node, where they run here as before.
     */
    worker?: AudioWorker;
    /** Inference time of one wake frame in the worker. */
    onWakeTiming?(ms: number): void;
    /** A wake frame dropped because the worker fell behind. */
    onWakeBacklog?(): void;
    /** Voice v2: the on-device speech model to use instead of voice.stt.whisperModel. */
    sttModel?(): ModelId | null;
  } = {},
) {
  const worker = hooks.worker;
  const wakeHooks = {
    ...(hooks.onWakeTiming ? { onTiming: hooks.onWakeTiming } : {}),
    ...(hooks.onWakeBacklog ? { onBacklog: hooks.onWakeBacklog } : {}),
  };
  let vad: Promise<Vad> | null = null;
  let whisper: { id: ModelId; model: Promise<Transcriber> } | null = null;
  let featureModels: Promise<OwwModels> | null = null;
  let spotterModel: Promise<SpotterModel> | null = null;
  /** Voice Match calibration of the spotter (ADR-044), only while enrolling. */
  let calibrator: { name: string; cal: ReturnType<typeof createCalibrator> } | null = null;

  /** A fresh set of the openWakeWord models (each wake engine owns and releases its own). */
  function owwModels(): Promise<OwwModels> {
    if (!store.installed('openwakeword-hey-jarvis'))
      return Promise.reject(notReady('"Hey Jarvis" wake-word model'));
    return loadOwwModels(store.dir('openwakeword-hey-jarvis'));
  }

  /** Caches the promise, but forgets a failed load so the next attempt retries. */
  function remember<T>(p: Promise<T>, forget: () => void): Promise<T> {
    p.catch(forget);
    return p;
  }

  /** The keyword spotter's model, loaded once and kept (a few MB). */
  function spotter(): Promise<SpotterModel> {
    if (!store.installed('kws-zipformer-en'))
      return Promise.reject(notReady('instant wake-word model'));
    spotterModel ??= remember(loadSpotterModel(store.dir('kws-zipformer-en')), () => {
      spotterModel = null;
    });
    return spotterModel;
  }

  const sttModelId = (): ModelId => hooks.sttModel?.() ?? settings.get('voice.stt.whisperModel');

  function transcriber(): Promise<Transcriber> {
    const id = sttModelId();
    if (whisper?.id === id) return whisper.model;
    if (!store.installed(id)) return Promise.reject(notReady('Whisper model'));
    const old = whisper;
    void old?.model.then((t) => t.release()).catch(() => undefined);
    const multilingual = LOCAL_STT_MODELS.find((m) => m.id === id)?.multilingual ?? false;
    const loaded = isolatedWhisper(store.dir(id), multilingual).then((t) =>
      hooks.onSlow ? watchSpeed(t, hooks.onSlow) : t,
    );
    const model = remember(loaded, () => {
      if (whisper?.model === model) whisper = null;
    });
    whisper = { id, model };
    return model;
  }

  /** The Silero voice detector: in the audio worker when there is one. */
  function openVad(): Promise<Vad & { release?(): void }> {
    const path = join(store.dir('silero-vad'), 'silero_vad.onnx');
    return worker ? worker.vad(path) : loadSileroVad(path);
  }

  function voiceActivity(): Promise<Vad> {
    if (!store.installed('silero-vad')) return Promise.reject(notReady('voice detector'));
    vad ??= remember(openVad(), () => {
      vad = null;
    });
    return vad;
  }
  // A crashed worker took the shared voice detector with it: open a fresh one next time.
  worker?.onCrash(() => {
    vad = null;
  });

  const stt: SttProvider = createWhisperStt({ vad: voiceActivity, transcriber });

  return {
    stt,
    /**
     * ADR-038: a phrase engine (cloud, own server, Windows) behind the same on-device voice
     * detector. No live re-reads: each one would be another paid request.
     */
    phraseStt(id: string, t: Transcriber): SttProvider {
      const base = createWhisperStt({ vad: voiceActivity, transcriber: async () => t });
      return { id, start: (o) => base.start({ ...o, livePartials: false }) };
    },
    /** The small voice detector the phrase engines need is downloaded. */
    vadReady: (): boolean => store.installed('silero-vad'),
    /** One clip (a voice note) through the warm Whisper model. */
    transcribe: async (audio: Float32Array, language: string): Promise<string> =>
      (await transcriber()).transcribe(audio, language),
    /** On-device speech is usable: the voice detector and the chosen Whisper model are downloaded. */
    ready: (): boolean => store.installed('silero-vad') && store.installed(sttModelId()),
    async wake(sensitivity: number): Promise<WakeWord> {
      const threshold = thresholdFor(sensitivity);
      if (worker) {
        if (!store.installed('openwakeword-hey-jarvis'))
          throw notReady('"Hey Jarvis" wake-word model');
        return worker.wake(
          { engine: 'openwakeword', dir: store.dir('openwakeword-hey-jarvis'), threshold },
          wakeHooks,
        );
      }
      return createOpenWakeWord(await owwModels(), threshold, Date.now, (score) =>
        hooks.onNearMiss?.({ engine: 'hey-jarvis', score: round2(score), threshold }),
      );
    },
    /**
     * ADR-043: Sir's own recorded "Hey <name>" is the wake word. With the default name the
     * "hey jarvis" model listens too, so either one wakes him.
     */
    async personalWake(
      sensitivity: number,
      templates: WakeTemplates,
      alsoHeyJarvis: boolean,
    ): Promise<WakeWord> {
      if (worker) {
        if (!store.installed('openwakeword-hey-jarvis'))
          throw notReady('"Hey Jarvis" wake-word model');
        return worker.wake(
          {
            engine: 'personal',
            dir: store.dir('openwakeword-hey-jarvis'),
            templates,
            sensitivity,
            ...(alsoHeyJarvis ? { classifierThreshold: thresholdFor(sensitivity) } : {}),
          },
          wakeHooks,
        );
      }
      return createPersonalWake(await owwModels(), templates, {
        sensitivity,
        ...(alsoHeyJarvis ? { classifierThreshold: thresholdFor(sensitivity) } : {}),
        onNearMiss: (distance, threshold) =>
          hooks.onNearMiss?.({
            engine: 'personal',
            distance: round2(distance),
            threshold: round2(threshold),
          }),
      });
    },
    /**
     * ADR-044: "Hey <name>" (and the bare name, and spellings learned while enrolling) by keyword
     * spotting. Sir's calibrated level can only make it more eager for his voice.
     */
    async spotterWake(sensitivity: number, name: string, learned: string[]): Promise<WakeWord> {
      const threshold = spotterThreshold(sensitivity, settings.get('voice.wake.spotterLevel'));
      if (worker) {
        if (!store.installed('kws-zipformer-en')) throw notReady('instant wake-word model');
        return worker.wake(
          {
            engine: 'spotter',
            dir: store.dir('kws-zipformer-en'),
            phrases: wakePhrases(name, learned),
            threshold,
          },
          wakeHooks,
        );
      }
      const model = await spotter();
      const engine = await model.open(
        keywordsText(wakePhrases(name, learned), model.pieces, threshold),
      );
      const timed = hooks.onSpotterDecode;
      const measured: KeywordEngine = timed
        ? {
            accept(samples) {
              const started = performance.now();
              const heard = engine.accept(samples);
              timed(performance.now() - started);
              return heard;
            },
            reset: () => engine.reset(),
          }
        : engine;
      return createSpotterWake(measured, {
        onHeard: (phrase) => hooks.onSpotted?.({ phrase, threshold }),
      });
    },
    /** The instant wake word's model is downloaded. */
    spotterReady: (): boolean => store.installed('kws-zipformer-en'),
    /** Enrolment: the strictest spotter level one "Hey <name>" passes (null without the model). */
    async spotterLevel(audio: Float32Array, name: string): Promise<number | null> {
      if (!store.installed('kws-zipformer-en')) return null;
      if (calibrator?.name !== name)
        calibrator = { name, cal: createCalibrator(await spotter(), wakePhrases(name)) };
      return calibrator.cal.level(audio);
    },
    /** Enrolment is over: drop the calibration spotters (one per level). */
    endCalibration(): void {
      calibrator = null;
    },
    /** The wake-word model is downloaded (needed for the personal wake word too). */
    wakeReady: (): boolean => store.installed('openwakeword-hey-jarvis'),
    /** One enrolment phrase as wake-word features (null without the wake-word model). */
    async wakeFeatures(audio: Float32Array): Promise<PhraseFeatures | null> {
      if (!store.installed('openwakeword-hey-jarvis')) return null;
      // Kept warm through the enrolment; never released (three small models, a few MB).
      featureModels ??= remember(owwModels(), () => {
        featureModels = null;
      });
      return phraseFeatures(await featureModels, audio);
    },
    /** ADR-012 always-listening: its own VAD instance, the shared (warm) Whisper. */
    async ambient(handlers: {
      onSpeechStart(): void;
      onSegment(seg: HeardSegment): void;
      onError(err: Error): void;
    }): Promise<ContinuousTranscriber> {
      if (!store.installed('silero-vad')) throw notReady('Whisper model');
      const [ownVad] = await Promise.all([
        openVad(),
        transcriber(), // warm it now so the first phrase isn't slow
      ]);
      const continuous = createContinuousTranscriber({
        vad: ownVad,
        // Looked up per phrase: switching the Whisper model disposes the old one, and holding on to
        // it made every later phrase fail with "Session already disposed".
        transcriber: {
          transcribe: async (audio, language) => (await transcriber()).transcribe(audio, language),
          release: async () => undefined,
        },
        language: () => settings.get('voice.stt.language'),
        endSilenceMs: () => settings.get('voice.endSilenceMs'),
        ...handlers,
      });
      // Its own detector in the worker goes when always-listening stops.
      return {
        ...continuous,
        close() {
          continuous.close();
          ownVad.release?.();
        },
      };
    },
    /** Loads Whisper in the background when it is selected, so the first command isn't slow. */
    /** `force`: voice v2 decides on-device speech is in use whatever voice.stt.provider says. */
    preload(force = false): void {
      if (!force && settings.get('voice.stt.provider') !== 'whisper') return;
      void Promise.all([voiceActivity(), transcriber()]).catch(() => undefined);
    },
  };
}

export type LocalEngines = ReturnType<typeof createLocalEngines>;
