import { join } from 'node:path';
import type * as Ort from 'onnxruntime-node';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import type { OwwModels } from './open-wake-word';

/** onnxruntime-node loads a native DLL, so it is imported only when a local engine is used (ADR-011). */
async function ort(): Promise<typeof Ort> {
  return import('onnxruntime-node');
}

const ONE_THREAD: InferenceSession.SessionOptions = {
  intraOpNumThreads: 1,
  interOpNumThreads: 1,
  executionProviders: ['cpu'],
};

async function session(path: string): Promise<InferenceSession> {
  return (await ort()).InferenceSession.create(path, ONE_THREAD);
}

const data = (t: Tensor | undefined): Float32Array => {
  if (!t) throw new Error('ONNX model returned no output');
  return t.data as Float32Array;
};

/** The three openWakeWord models from models/openwakeword-hey-jarvis. */
export async function loadOwwModels(dir: string): Promise<OwwModels> {
  const { Tensor } = await ort();
  const [mel, emb, cls] = await Promise.all([
    session(join(dir, 'melspectrogram.onnx')),
    session(join(dir, 'embedding_model.onnx')),
    session(join(dir, 'hey_jarvis_v0.1.onnx')),
  ]);
  const first = (s: InferenceSession): string => s.inputNames[0] ?? 'input';
  return {
    async mel(audio) {
      const out = await mel.run({ [first(mel)]: new Tensor('float32', audio, [1, audio.length]) });
      return data(out[mel.outputNames[0] ?? '']);
    },
    async embed(window) {
      const out = await emb.run({ [first(emb)]: new Tensor('float32', window, [1, 76, 32, 1]) });
      return data(out[emb.outputNames[0] ?? '']);
    },
    async classify(features) {
      const out = await cls.run({ [first(cls)]: new Tensor('float32', features, [1, 16, 96]) });
      return data(out[cls.outputNames[0] ?? ''])[0] ?? 0;
    },
    release() {
      void mel.release();
      void emb.release();
      void cls.release();
    },
  };
}

export interface Vad {
  /** Speech probability for one 512-sample window (32 ms) of 16 kHz audio in [-1, 1]. */
  prob(window: Float32Array): Promise<number>;
  reset(): void;
}

export const VAD_WINDOW = 512;
const VAD_CONTEXT = 64;

/** Silero VAD v6 (MIT): stateful, 64-sample context prepended to each 512-sample window, as upstream's OnnxWrapper. */
export async function loadSileroVad(path: string): Promise<Vad> {
  const { Tensor } = await ort();
  const s = await session(path);
  let state = new Float32Array(2 * 128);
  let context = new Float32Array(VAD_CONTEXT);
  const sr = new Tensor('int64', BigInt64Array.from([16000n]), []);
  return {
    async prob(window) {
      const x = new Float32Array(VAD_CONTEXT + window.length);
      x.set(context);
      x.set(window, VAD_CONTEXT);
      const out = await s.run({
        input: new Tensor('float32', x, [1, x.length]),
        state: new Tensor('float32', state, [2, 1, 128]),
        sr,
      });
      state = Float32Array.from(data(out['stateN']));
      context = x.slice(-VAD_CONTEXT);
      return data(out['output'])[0] ?? 0;
    },
    reset() {
      state = new Float32Array(2 * 128);
      context = new Float32Array(VAD_CONTEXT);
    },
  };
}
