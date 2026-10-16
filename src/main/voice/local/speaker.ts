/**
 * ADR-039 Voice Match: WavLM base plus SV (x-vector head) turns a phrase into a 512-number voice
 * fingerprint, via transformers.js on onnxruntime-node. Runs in the model process (ADR-029).
 */
export interface SpeakerModel {
  /** 16 kHz mono audio in [-1, 1] → embedding. */
  embed(audio: Float32Array): Promise<Float32Array>;
  release(): Promise<void>;
}

/** `dir` is models/wavlm-speaker (config, preprocessor config, onnx/model_quantized.onnx). */
export async function loadSpeakerModel(dir: string, threads?: number): Promise<SpeakerModel> {
  const { env, AutoProcessor, AutoModelForXVector } = await import('@huggingface/transformers');
  // Never fetch anything at runtime: only the files Jarvis downloaded and verified.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '';
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(dir),
    AutoModelForXVector.from_pretrained(dir, {
      dtype: 'q8',
      device: 'cpu',
      ...(threads ? { session_options: { intraOpNumThreads: threads } } : {}),
    }),
  ]);
  return {
    async embed(audio) {
      const inputs = (await processor(audio)) as Record<string, unknown>;
      const out = (await model(inputs)) as { embeddings: { data: Float32Array } };
      return Float32Array.from(out.embeddings.data);
    },
    release: async () => {
      await model.dispose();
    },
  };
}

/** Unit length, so a dot product is the cosine similarity. */
export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  return v.map((x) => x / len);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const x = normalize(a);
  const y = normalize(b);
  let dot = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) dot += (x[i] ?? 0) * (y[i] ?? 0);
  return dot;
}

function mean(vs: Float32Array[]): Float32Array {
  const out = new Float32Array(vs[0]?.length ?? 0);
  for (const v of vs) for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (v[i] ?? 0);
  return normalize(out);
}

/** Lowest and highest threshold enrolment may suggest. */
const MIN_THRESHOLD = 0.55;
const MAX_THRESHOLD = 0.9;
/** Below the weakest enrolment phrase, so Sir's own quieter or rushed phrases still pass. */
const MARGIN = 0.05;

/**
 * Sir's voice from his enrolment phrases: their average, and a threshold set just under how well
 * each phrase matches the average of the others (leave-one-out), so it fits his voice and mic.
 */
export function buildProfile(embeddings: Float32Array[]): {
  centroid: Float32Array;
  threshold: number;
  scores: number[];
} {
  if (embeddings.length < 2) throw new Error('need at least two phrases');
  const unit = embeddings.map(normalize);
  const scores = unit.map((e, i) => cosine(e, mean(unit.filter((_, j) => j !== i))));
  const threshold = Math.min(
    MAX_THRESHOLD,
    Math.max(MIN_THRESHOLD, Math.round((Math.min(...scores) - MARGIN) * 100) / 100),
  );
  return { centroid: mean(unit), threshold, scores };
}

export interface StoredProfile {
  v: 1;
  model: 'wavlm-speaker';
  /** base64 of the Float32 centroid. */
  centroid: string;
  samples: number;
  createdAt: number;
}

export function encodeProfile(centroid: Float32Array, samples: number, now: number): string {
  const p: StoredProfile = {
    v: 1,
    model: 'wavlm-speaker',
    centroid: Buffer.from(centroid.buffer, centroid.byteOffset, centroid.byteLength).toString(
      'base64',
    ),
    samples,
    createdAt: now,
  };
  return JSON.stringify(p);
}

export function decodeProfile(raw: string): {
  centroid: Float32Array;
  samples: number;
  createdAt: number;
} {
  const p = JSON.parse(raw) as Partial<StoredProfile>;
  if (p.v !== 1 || p.model !== 'wavlm-speaker' || typeof p.centroid !== 'string')
    throw new Error('unknown voice profile');
  const b = Buffer.from(p.centroid, 'base64');
  if (b.byteLength % 4 !== 0) throw new Error('bad voice profile');
  const centroid = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (centroid.length < 64 || !centroid.every(Number.isFinite))
    throw new Error('bad voice profile');
  return { centroid, samples: p.samples ?? 0, createdAt: p.createdAt ?? 0 };
}
