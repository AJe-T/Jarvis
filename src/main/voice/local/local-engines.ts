import { join } from 'node:path';
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
import { loadWhisper, type Transcriber } from './whisper';

const notReady = (what: string): JarvisError =>
  new JarvisError(
    'INVALID',
    `${what} not downloaded`,
    `Download the ${what} in Settings → Voice first.`,
  );

/** ADR-011: on-device openWakeWord and Whisper. Models load once and stay warm. */
export function createLocalEngines(store: ModelStore, settings: SettingsService) {
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
    const model = remember(loadWhisper(store.dir(id), id === 'whisper-small'), () => {
      if (whisper?.model === model) whisper = null;
    });
    whisper = { id, model };
    return model;
  }

  function voiceActivity(): Promise<Vad> {
    if (!store.installed('silero-vad')) return Promise.reject(notReady('Whisper model'));
    vad ??= remember(loadSileroVad(join(store.dir('silero-vad'), 'silero_vad.onnx')), () => {
      vad = null;
    });
    return vad;
  }

  const stt: SttProvider = createWhisperStt({ vad: voiceActivity, transcriber });

  return {
    stt,
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
