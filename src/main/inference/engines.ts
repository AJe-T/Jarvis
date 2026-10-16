import { availableParallelism } from 'node:os';
import type { InferenceSession } from 'onnxruntime-node';
import { loadDecider, type Decider } from '../laya/laya';
import { loadWhisper, type Transcriber } from '../voice/local/whisper';
import { loadSpeakerModel, type SpeakerModel } from '../voice/local/speaker';

/**
 * ADR-029: the heavy on-device models (Whisper, Kokoro, Laya). onnxruntime-node runs a model
 * synchronously on the JS thread, so these run in their own process (inference/host.ts) and the
 * main process stays free for windows and IPC. Tests and plain Node use them in-process.
 * Every request carries what it needs to load its model, so a restarted host reloads by itself.
 */

export type LayaQuestions = Parameters<Decider['predict']>[1];
export type LayaAnswers = Awaited<ReturnType<Decider['predict']>>;

export interface WhisperReq {
  dir: string;
  multilingual: boolean;
}
export interface KokoroReq {
  modelPath: string;
}

export interface InferenceOps {
  whisperWarm(req: WhisperReq): Promise<void>;
  transcribe(req: WhisperReq & { audio: Float32Array; language?: string }): Promise<string>;
  whisperRelease(req: { dir: string }): Promise<void>;
  layaWarm(req: { dir: string }): Promise<void>;
  layaPredict(req: {
    dir: string;
    state: Record<string, string>;
    questions: LayaQuestions;
  }): Promise<LayaAnswers>;
  kokoroWarm(req: KokoroReq): Promise<void>;
  kokoroRun(
    req: KokoroReq & { inputIds: BigInt64Array; style: Float32Array; speed: number },
  ): Promise<Float32Array>;
  /** ADR-039 Voice Match: a phrase → Sir's-voice fingerprint (WavLM x-vector). */
  speakerEmbed(req: { dir: string; audio: Float32Array }): Promise<Float32Array>;
  /** Piper (VITS): phoneme ids + [noise, length, noise_w] scales → audio at the voice's sample rate. */
  piperRun(req: {
    modelPath: string;
    ids: BigInt64Array;
    scales: Float32Array;
    speakerId?: number;
  }): Promise<Float32Array>;
}

/** Half the logical cores (the physical ones on most laptops), at most 4: more was slower (measured). */
export const MODEL_THREADS = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

/** Caches a load by key; a failed load is forgotten so the next request retries. */
function cache<T>() {
  const loaded = new Map<string, Promise<T>>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      let p = loaded.get(key);
      if (!p) {
        p = load();
        loaded.set(key, p);
        p.catch(() => loaded.delete(key));
      }
      return p;
    },
    take(key: string): Promise<T> | undefined {
      const p = loaded.get(key);
      loaded.delete(key);
      return p;
    },
  };
}

export function createLocalOps(): InferenceOps {
  const whispers = cache<Transcriber>();
  const deciders = cache<Decider>();
  const kokoros = cache<InferenceSession>();

  const whisper = (r: WhisperReq): Promise<Transcriber> =>
    whispers.get(r.dir, () => loadWhisper(r.dir, r.multilingual, MODEL_THREADS));
  const decider = (dir: string): Promise<Decider> =>
    deciders.get(dir, () => loadDecider(dir, MODEL_THREADS));
  const openSession = async (modelPath: string): Promise<InferenceSession> => {
    const ort = await import('onnxruntime-node');
    return ort.InferenceSession.create(modelPath, {
      intraOpNumThreads: MODEL_THREADS,
      executionProviders: ['cpu'],
    });
  };
  const kokoro = (r: KokoroReq): Promise<InferenceSession> =>
    kokoros.get(r.modelPath, () => openSession(r.modelPath));
  const pipers = cache<InferenceSession>();
  const speakers = cache<SpeakerModel>();

  return {
    async whisperWarm(r) {
      await whisper(r);
    },
    async transcribe(r) {
      return (await whisper(r)).transcribe(r.audio, r.language);
    },
    async whisperRelease({ dir }) {
      await (await whispers.take(dir)?.catch(() => null))?.release();
    },
    async layaWarm({ dir }) {
      await decider(dir);
    },
    async layaPredict(r) {
      return (await decider(r.dir)).predict(r.state, r.questions);
    },
    async kokoroWarm(r) {
      await kokoro(r);
    },
    async kokoroRun(r) {
      const session = await kokoro(r);
      const { Tensor } = await import('onnxruntime-node');
      const out = await session.run({
        input_ids: new Tensor('int64', r.inputIds, [1, r.inputIds.length]),
        style: new Tensor('float32', r.style, [1, r.style.length]),
        speed: new Tensor('float32', new Float32Array([r.speed]), [1]),
      });
      const wave = out['waveform']?.data as Float32Array | undefined;
      if (!wave?.length) throw new Error('Kokoro returned no audio');
      return wave;
    },
    async speakerEmbed(r) {
      const m = await speakers.get(r.dir, () => loadSpeakerModel(r.dir, MODEL_THREADS));
      return m.embed(r.audio);
    },
    async piperRun(r) {
      const session = await pipers.get(r.modelPath, () => openSession(r.modelPath));
      const { Tensor } = await import('onnxruntime-node');
      const feeds: Record<string, InstanceType<typeof Tensor>> = {
        input: new Tensor('int64', r.ids, [1, r.ids.length]),
        input_lengths: new Tensor('int64', BigInt64Array.from([BigInt(r.ids.length)]), [1]),
        scales: new Tensor('float32', r.scales, [3]),
      };
      if (r.speakerId !== undefined && session.inputNames.includes('sid'))
        feeds['sid'] = new Tensor('int64', BigInt64Array.from([BigInt(r.speakerId)]), [1]);
      const out = await session.run(feeds);
      const wave = out[session.outputNames[0] ?? 'output']?.data as Float32Array | undefined;
      if (!wave?.length) throw new Error('Piper returned no audio');
      return wave;
    },
  };
}
