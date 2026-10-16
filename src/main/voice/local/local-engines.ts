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
import { createOpenWakeWord, thresholdFor } from './open-wake-word';
import type { Transcriber } from './whisper';
import { inference } from '../../inference/client';

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

/** ADR-011: on-device openWakeWord and Whisper. Models load once and stay warm. */
export function createLocalEngines(
  store: ModelStore,
  settings: SettingsService,
  hooks: { onSlow?(): void } = {},
) {
  let vad: Promise<Vad> | null = null;
  let whisper: { id: ModelId; model: Promise<Transcriber> } | null = null;

  /** Caches the promise, but forgets a failed load so the next attempt retries. */
  function remember<T>(p: Promise<T>, forget: () => void): Promise<T> {
    p.catch(forget);
    return p;
  }

  function transcriber(): Promise<Transcriber> {
    const id = settings.get('voice.stt.whisperModel');
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

  function voiceActivity(): Promise<Vad> {
    if (!store.installed('silero-vad')) return Promise.reject(notReady('voice detector'));
    vad ??= remember(loadSileroVad(join(store.dir('silero-vad'), 'silero_vad.onnx')), () => {
      vad = null;
    });
    return vad;
  }

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
    ready: (): boolean =>
      store.installed('silero-vad') && store.installed(settings.get('voice.stt.whisperModel')),
    async wake(sensitivity: number): Promise<WakeWord> {
      if (!store.installed('openwakeword-hey-jarvis'))
        throw notReady('"Hey Jarvis" wake-word model');
      return createOpenWakeWord(
        await loadOwwModels(store.dir('openwakeword-hey-jarvis')),
        thresholdFor(sensitivity),
      );
    },
    /** ADR-012 always-listening: its own VAD instance, the shared (warm) Whisper. */
    async ambient(handlers: {
      onSpeechStart(): void;
      onSegment(seg: HeardSegment): void;
      onError(err: Error): void;
    }): Promise<ContinuousTranscriber> {
      if (!store.installed('silero-vad')) throw notReady('Whisper model');
      const [ownVad] = await Promise.all([
        loadSileroVad(join(store.dir('silero-vad'), 'silero_vad.onnx')),
        transcriber(), // warm it now so the first phrase isn't slow
      ]);
      return createContinuousTranscriber({
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
    },
    /** Loads Whisper in the background when it is selected, so the first command isn't slow. */
    preload(): void {
      if (settings.get('voice.stt.provider') !== 'whisper') return;
      void Promise.all([voiceActivity(), transcriber()]).catch(() => undefined);
    },
  };
}

export type LocalEngines = ReturnType<typeof createLocalEngines>;
