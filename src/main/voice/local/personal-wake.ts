import type { WakeWord } from '../types';
import {
  DEBOUNCE_MS,
  EMBEDDING,
  OWW_CHUNK,
  chunkedWake,
  createClassifier,
  createFeatureStream,
  type OwwModels,
} from './open-wake-word';

/**
 * ADR-043 personal wake word: Sir's own "Hey <name>", recorded during Voice Match enrolment, is the
 * wake word. Same idea as Snowboy's personal models and EfficientWord-Net (few-shot keyword
 * spotting on a general speech embedding), written for openWakeWord's embedding model, which was
 * built for exactly this (Google's speech_embedding):
 * - each recorded phrase becomes a template: its sequence of 96-float embeddings (one per 80 ms);
 * - while listening, the latest embeddings are compared with every template by subsequence dynamic
 *   time warping (the whole template must match, ending now, starting anywhere), so a slower or
 *   faster "Hey Jarvis" still lines up;
 * - the threshold comes from how much Sir's own phrases differ from each other.
 * Any name works, in any accent, offline. With the default name the "hey jarvis" model also runs
 * on the same features, so either can wake Jarvis.
 */

/** Chunk loudness (RMS of [-1, 1] samples) that counts as speech. */
const LOUD_RMS = 0.015;
/** Embeddings kept after the last loud chunk: the embedding window still "hears" the phrase. */
const TAIL_CHUNKS = 3;
/** Templates are compared only while there was speech this recently (cheap, and no wakes from silence). */
const SPEECH_RECENT_CHUNKS = 6;
/** The search window is this much longer than the longest template (slow speech). */
const WINDOW_STRETCH = 1.6;
const MIN_TEMPLATE = 4;
const MAX_TEMPLATE = 40;
/** Bounds for the distance threshold, whatever the enrolment phrases looked like. */
const MIN_THRESHOLD = 0.06;
const MAX_THRESHOLD = 0.3;

/** One recorded phrase: an embedding per 80 ms chunk, and whether that chunk was loud (speech). */
export interface PhraseFeatures {
  embeddings: Float32Array[];
  loud: boolean[];
}

export interface WakeTemplates {
  /** Average embedding of the enrolment audio; subtracted so distances spread out. */
  mean: Float32Array;
  templates: Float32Array[][];
  /** Average distance between Sir's own phrases (leave-one-out). */
  spread: number;
}

function unit(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const len = Math.sqrt(s) || 1;
  return v.map((x) => x / len);
}

const centred = (v: Float32Array, mean: Float32Array): Float32Array =>
  unit(v.map((x, i) => x - (mean[i] ?? 0)));

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return 1 - dot;
}

/**
 * Subsequence DTW: the whole template against a window that ends now and may start anywhere.
 * Steps: diagonal, or stay on a template frame, or stay on a window frame. Returns the average
 * cost per step along the best path (0 = identical).
 */
export function matchDistance(template: Float32Array[], window: Float32Array[]): number {
  const m = window.length;
  if (template.length === 0 || m === 0) return Infinity;
  let prev = new Float64Array(m);
  let prevLen = new Float64Array(m);
  let cur = new Float64Array(m);
  let curLen = new Float64Array(m);
  const first = template[0] as Float32Array;
  for (let j = 0; j < m; j++) {
    prev[j] = cosineDistance(first, window[j] as Float32Array);
    prevLen[j] = 1;
  }
  for (let i = 1; i < template.length; i++) {
    const t = template[i] as Float32Array;
    for (let j = 0; j < m; j++) {
      let best = prev[j] as number;
      let len = prevLen[j] as number;
      if (j > 0) {
        if ((prev[j - 1] as number) < best) {
          best = prev[j - 1] as number;
          len = prevLen[j - 1] as number;
        }
        if ((cur[j - 1] as number) < best) {
          best = cur[j - 1] as number;
          len = curLen[j - 1] as number;
        }
      }
      cur[j] = best + cosineDistance(t, window[j] as Float32Array);
      curLen[j] = len + 1;
    }
    [prev, cur] = [cur, prev];
    [prevLen, curLen] = [curLen, prevLen];
  }
  return (prev[m - 1] as number) / (prevLen[m - 1] as number);
}

function chunkRms(chunk: Int16Array): number {
  let s = 0;
  for (const x of chunk) s += (x / 32768) ** 2;
  return Math.sqrt(s / chunk.length);
}

/** One enrolment phrase (16 kHz floats in [-1, 1]) → its embeddings and loudness, 80 ms apart. */
export async function phraseFeatures(
  models: Pick<OwwModels, 'mel' | 'embed'>,
  audio: Float32Array,
): Promise<PhraseFeatures> {
  const features = createFeatureStream(models);
  // Half a second of silence first, like the live stream before Sir speaks.
  const samples = new Int16Array(8000 + audio.length + OWW_CHUNK * TAIL_CHUNKS);
  audio.forEach((x, i) => (samples[8000 + i] = Math.max(-1, Math.min(1, x)) * 32767));
  const embeddings: Float32Array[] = [];
  const loud: boolean[] = [];
  for (let at = 0; at + OWW_CHUNK <= samples.length; at += OWW_CHUNK) {
    const chunk = samples.subarray(at, at + OWW_CHUNK);
    embeddings.push(await features(chunk));
    loud.push(chunkRms(chunk) >= LOUD_RMS);
  }
  return { embeddings, loud };
}

/** Phrases → templates (just the spoken part) and the spread of Sir's own phrases. Null if unusable. */
export function buildTemplates(phrases: PhraseFeatures[]): WakeTemplates | null {
  const all = phrases.flatMap((p) => p.embeddings);
  if (phrases.length < 2 || all.length === 0) return null;
  const mean = new Float32Array(EMBEDDING);
  for (const e of all)
    for (let i = 0; i < EMBEDDING; i++) mean[i] = (mean[i] ?? 0) + (e[i] ?? 0) / all.length;
  const templates = phrases
    .map((p) => {
      const first = p.loud.indexOf(true);
      const last = p.loud.lastIndexOf(true);
      if (first < 0) return [];
      return p.embeddings
        .slice(first, Math.min(p.embeddings.length, last + 1 + TAIL_CHUNKS))
        .slice(0, MAX_TEMPLATE)
        .map((e) => centred(e, mean));
    })
    .filter((t) => t.length >= MIN_TEMPLATE);
  if (templates.length < 2) return null;
  const distances = templates.flatMap((t, i) =>
    templates.filter((_, j) => j !== i).map((other) => matchDistance(t, other)),
  );
  return { mean, templates, spread: distances.reduce((a, b) => a + b, 0) / distances.length };
}

/** Sensitivity 0..1 (higher = more eager) → distance threshold; the default 0.6 is 0.76 × the spread. */
export function distanceThreshold(spread: number, sensitivity: number): number {
  const factor = 0.4 + 0.6 * Math.min(1, Math.max(0, sensitivity));
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, spread * factor));
}

export function createPersonalWake(
  models: OwwModels,
  stored: WakeTemplates,
  opts: {
    sensitivity: number;
    /** Also run the "hey jarvis" model (default name), at this threshold. */
    classifierThreshold?: number;
    onNearMiss?(distance: number, threshold: number): void;
    now?(): number;
  },
): WakeWord {
  const now = opts.now ?? Date.now;
  const threshold = distanceThreshold(stored.spread, opts.sensitivity);
  const features = createFeatureStream(models);
  const classify = opts.classifierThreshold !== undefined ? createClassifier(models) : null;
  const longest = Math.max(...stored.templates.map((t) => t.length));
  const keep = Math.ceil(longest * WINDOW_STRETCH);
  let recent: Float32Array[] = [];
  let sinceLoud = Infinity;
  let lastFire = -Infinity;
  /** Closest match of the phrase being spoken, logged when it ends without waking (a near miss). */
  let burst = { best: Infinity, fired: false };

  return chunkedWake(async (chunk) => {
    const embedding = await features(chunk);
    sinceLoud = chunkRms(chunk) >= LOUD_RMS ? 0 : sinceLoud + 1;
    recent.push(centred(embedding, stored.mean));
    if (recent.length > keep) recent = recent.slice(-keep);
    const score = classify ? await classify(embedding) : 0;
    if (sinceLoud > SPEECH_RECENT_CHUNKS) {
      if (!burst.fired && burst.best < threshold * 2) opts.onNearMiss?.(burst.best, threshold);
      burst = { best: Infinity, fired: false };
      return false;
    }
    if (recent.length < MIN_TEMPLATE) return false;
    let distance = Infinity;
    for (const t of stored.templates) distance = Math.min(distance, matchDistance(t, recent));
    burst.best = Math.min(burst.best, distance);
    const heard =
      distance <= threshold ||
      (opts.classifierThreshold !== undefined && score >= opts.classifierThreshold);
    if (!heard) return false;
    burst.fired = true; // a match, even if debounced, is not a near miss
    if (now() - lastFire < DEBOUNCE_MS) return false;
    lastFire = now();
    recent = []; // the same phrase must not match again on the next chunk
    return true;
  }, models.release);
}

// ── storage (an internal secret: it is Sir's voice) ─────────────────────────────────────────
interface StoredTemplates {
  v: 1;
  model: 'openwakeword';
  dim: number;
  mean: string;
  lengths: number[];
  /** base64 of every template frame, concatenated. */
  frames: string;
  spread: number;
}

const b64 = (v: Float32Array): string =>
  Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
function floats(s: string): Float32Array {
  const b = Buffer.from(s, 'base64');
  if (b.byteLength % 4 !== 0) throw new Error('bad wake templates');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function encodeTemplates(t: WakeTemplates): string {
  const flat = new Float32Array(t.templates.reduce((n, x) => n + x.length * EMBEDDING, 0));
  let at = 0;
  for (const frame of t.templates.flat()) {
    flat.set(frame, at);
    at += EMBEDDING;
  }
  const out: StoredTemplates = {
    v: 1,
    model: 'openwakeword',
    dim: EMBEDDING,
    mean: b64(t.mean),
    lengths: t.templates.map((x) => x.length),
    frames: b64(flat),
    spread: t.spread,
  };
  return JSON.stringify(out);
}

export function decodeTemplates(raw: string): WakeTemplates {
  const p = JSON.parse(raw) as Partial<StoredTemplates>;
  if (p.v !== 1 || p.model !== 'openwakeword' || p.dim !== EMBEDDING)
    throw new Error('unknown wake templates');
  const mean = floats(p.mean ?? '');
  const flat = floats(p.frames ?? '');
  const lengths = p.lengths ?? [];
  const total = lengths.reduce((a, b) => a + b, 0);
  if (
    mean.length !== EMBEDDING ||
    !mean.every(Number.isFinite) ||
    lengths.length < 2 ||
    lengths.some((n) => !Number.isInteger(n) || n < MIN_TEMPLATE || n > MAX_TEMPLATE) ||
    flat.length !== total * EMBEDDING ||
    !flat.every(Number.isFinite) ||
    typeof p.spread !== 'number' ||
    !(p.spread > 0 && p.spread < 2)
  )
    throw new Error('bad wake templates');
  let at = 0;
  const templates = lengths.map((n) =>
    Array.from({ length: n }, () => {
      const frame = flat.slice(at, at + EMBEDDING);
      at += EMBEDDING;
      return frame;
    }),
  );
  return { mean, templates, spread: p.spread };
}
