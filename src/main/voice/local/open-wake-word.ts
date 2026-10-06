import type { WakeWord } from '../types';

/**
 * openWakeWord "hey jarvis" in TypeScript (ADR-011). Re-implements the pipeline of
 * dscripka/openWakeWord (Apache-2.0) `AudioFeatures` + `Model.predict` for 16 kHz audio in 80 ms chunks:
 * raw audio → melspectrogram model (x/10 + 2) → 76-frame windows every 8 frames → embedding model (96 floats)
 * → last 16 embeddings → classifier score.
 */
export const OWW_CHUNK = 1280; // 80 ms
const MEL_CONTEXT = 160 * 3; // extra samples the melspectrogram model needs per chunk
const MEL_BINS = 32;
const WINDOW = 76; // mel frames per embedding
const FEATURES = 16; // embeddings per prediction
const MEL_MAX = 970; // ~10 s, as upstream
const FEATURES_MAX = 120;
const WARMUP_PREDICTIONS = 5; // upstream zeroes the first 5 predictions
const DEBOUNCE_MS = 2000;

/** The three ONNX models, behind a seam so the pipeline is testable without onnxruntime. */
export interface OwwModels {
  /** int16 samples as float32 → mel frames, flattened [frames × 32] (before the x/10+2 transform). */
  mel(audio: Float32Array): Promise<Float32Array>;
  /** [76 × 32] window → 96-float embedding. */
  embed(window: Float32Array): Promise<Float32Array>;
  /** [16 × 96] features → score 0..1. */
  classify(features: Float32Array): Promise<number>;
  release(): void;
}

/** Porcupine sensitivity (higher = more eager) → openWakeWord threshold (default 0.5 at sensitivity 0.6). */
export function thresholdFor(sensitivity: number): number {
  return Math.min(0.9, Math.max(0.2, 1.1 - sensitivity));
}

export function createOpenWakeWord(
  models: OwwModels,
  threshold: number,
  now: () => number = Date.now,
): WakeWord & { scores: number[] } {
  let pending = new Int16Array(0);
  let raw = new Float32Array(0); // last OWW_CHUNK + MEL_CONTEXT samples
  let mel: Float32Array[] = Array.from({ length: WINDOW }, () =>
    new Float32Array(MEL_BINS).fill(1),
  );
  let features: Float32Array[] = [];
  let predictions = 0;
  let lastFire = -Infinity;
  const scores: number[] = [];

  async function chunk(samples: Int16Array): Promise<boolean> {
    const joined = new Float32Array(raw.length + samples.length);
    joined.set(raw);
    joined.set(Float32Array.from(samples), raw.length);
    raw = joined.slice(-(OWW_CHUNK + MEL_CONTEXT));

    const frames = await models.mel(raw);
    for (let i = 0; i + MEL_BINS <= frames.length; i += MEL_BINS)
      mel.push(frames.slice(i, i + MEL_BINS).map((v) => v / 10 + 2));
    if (mel.length > MEL_MAX) mel = mel.slice(-MEL_MAX);

    const window = new Float32Array(WINDOW * MEL_BINS);
    mel.slice(-WINDOW).forEach((row, i) => window.set(row, i * MEL_BINS));
    features.push(await models.embed(window));
    if (features.length > FEATURES_MAX) features = features.slice(-FEATURES_MAX);
    if (features.length < FEATURES) return false;

    const input = new Float32Array(FEATURES * 96);
    features.slice(-FEATURES).forEach((f, i) => input.set(f, i * 96));
    const score = predictions++ < WARMUP_PREDICTIONS ? 0 : await models.classify(input);
    scores.push(score);
    if (scores.length > 50) scores.shift();
    if (score < threshold || now() - lastFire < DEBOUNCE_MS) return false;
    lastFire = now();
    return true;
  }

  return {
    frameLength: OWW_CHUNK,
    scores,
    async process(frame) {
      const all = new Int16Array(pending.length + frame.length);
      all.set(pending);
      all.set(frame, pending.length);
      let fired = false;
      let at = 0;
      for (; at + OWW_CHUNK <= all.length; at += OWW_CHUNK)
        if (await chunk(all.subarray(at, at + OWW_CHUNK))) fired = true;
      pending = all.slice(at);
      return fired;
    },
    release: () => models.release(),
  };
}
