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
export const EMBEDDING = 96;
const MEL_MAX = 970; // ~10 s, as upstream
const FEATURES_MAX = 120;
const WARMUP_PREDICTIONS = 5; // upstream zeroes the first 5 predictions
export const DEBOUNCE_MS = 2000;
/** Scores this close to the threshold are logged as near misses, so a missed wake shows up. */
const NEAR_MISS = 0.6;

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

const blankMel = (): Float32Array[] =>
  Array.from({ length: WINDOW }, () => new Float32Array(MEL_BINS).fill(1));

/**
 * Audio → one 96-float speech embedding per 80 ms chunk (the shared front half of openWakeWord).
 * reset() forgets the audio heard so far, as if the stream had just started.
 */
export function createFeatureStream(models: Pick<OwwModels, 'mel' | 'embed'>) {
  let raw = new Float32Array(0); // last OWW_CHUNK + MEL_CONTEXT samples
  let mel = blankMel();
  const next = async (samples: Int16Array): Promise<Float32Array> => {
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
    return models.embed(window);
  };
  return Object.assign(next, {
    reset(): void {
      raw = new Float32Array(0);
      mel = blankMel();
    },
  });
}

/** The "hey jarvis" classifier over the last 16 embeddings, with upstream's warm-up (again after reset). */
export function createClassifier(models: Pick<OwwModels, 'classify'>) {
  let features: Float32Array[] = [];
  let predictions = 0;
  const score = async (embedding: Float32Array): Promise<number> => {
    features.push(embedding);
    if (features.length > FEATURES_MAX) features = features.slice(-FEATURES_MAX);
    if (features.length < FEATURES) return 0;
    const input = new Float32Array(FEATURES * EMBEDDING);
    features.slice(-FEATURES).forEach((f, i) => input.set(f, i * EMBEDDING));
    return predictions++ < WARMUP_PREDICTIONS ? 0 : models.classify(input);
  };
  return Object.assign(score, {
    reset(): void {
      features = [];
      predictions = 0;
    },
  });
}

/**
 * Re-cuts mic frames of any length into 80 ms chunks for `onChunk` (true = woken), one chunk at a
 * time. release() waits for a running inference: disposing ONNX sessions mid-run fails ("Session
 * already disposed"). reset() drops the part chunk and calls `onReset` to clear the engine's state.
 */
export function chunkedWake(
  onChunk: (chunk: Int16Array) => Promise<boolean>,
  releaseModels: () => void,
  onReset: () => void = () => undefined,
): WakeWord {
  let pending = new Int16Array(0);
  let inflight: Promise<unknown> = Promise.resolve();
  let released = false;

  async function processFrame(frame: Int16Array): Promise<boolean> {
    const all = new Int16Array(pending.length + frame.length);
    all.set(pending);
    all.set(frame, pending.length);
    let fired = false;
    let at = 0;
    for (; at + OWW_CHUNK <= all.length; at += OWW_CHUNK)
      if (await onChunk(all.subarray(at, at + OWW_CHUNK))) fired = true;
    pending = all.slice(at);
    return fired;
  }

  return {
    frameLength: OWW_CHUNK,
    // Frames may arrive before the last one finished (the mic loop doesn't wait): one at a time.
    process(frame) {
      if (released) return Promise.resolve(false);
      const run = inflight.then(() => processFrame(frame));
      inflight = run.catch(() => undefined);
      return run;
    },
    reset: () => {
      // After the frames already queued, so a reset never lands in the middle of one.
      inflight = inflight.then(() => {
        pending = new Int16Array(0);
        onReset();
      });
    },
    release: () => {
      released = true;
      void inflight.then(() => releaseModels());
    },
  };
}

/** Tracks the best score of each burst below the threshold and reports it once the burst ends. */
export function nearMissTracker(threshold: number, report: (peak: number) => void) {
  let peak = 0;
  return (score: number, fired: boolean): void => {
    if (fired) peak = 0;
    else if (score >= threshold * NEAR_MISS) peak = Math.max(peak, score);
    else if (peak > 0) {
      report(peak);
      peak = 0;
    }
  };
}

export function createOpenWakeWord(
  models: OwwModels,
  threshold: number,
  now: () => number = Date.now,
  onNearMiss?: (score: number) => void,
): WakeWord & { scores: number[] } {
  const features = createFeatureStream(models);
  const classify = createClassifier(models);
  const nearMiss = onNearMiss ? nearMissTracker(threshold, onNearMiss) : undefined;
  let lastFire = -Infinity;
  const scores: number[] = [];

  const wake = chunkedWake(
    async (chunk) => {
      const score = await classify(await features(chunk));
      scores.push(score);
      if (scores.length > 50) scores.shift();
      const fired = score >= threshold && now() - lastFire >= DEBOUNCE_MS;
      nearMiss?.(score, fired || score >= threshold);
      if (!fired) return false;
      lastFire = now();
      return true;
    },
    models.release,
    () => {
      // The "Hey Jarvis" that woke him is still in these buffers; left there it fires again.
      features.reset();
      classify.reset();
      scores.length = 0;
    },
  );
  return Object.assign(wake, { scores });
}
