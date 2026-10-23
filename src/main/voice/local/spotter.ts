import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type * as Sherpa from 'sherpa-onnx-node';
import { JarvisError } from '../../errors';
import type { WakeWord } from '../types';
import { phrasePieces, readWordPieces, spotterWords } from './word-pieces';

/**
 * ADR-044: the wake word as open-vocabulary keyword spotting. A 3.3M-parameter streaming
 * Zipformer (k2-fsa, Apache-2.0) decodes only the wake phrases, so any name works with no
 * training, in about 1–2 % of one CPU core, and fires ~0.3 s after "Hey Jarvis" ends instead of
 * waiting for the pause plus a Whisper pass. Runs through sherpa-onnx-node (Apache-2.0).
 */

/** The model files, as named in the release archive (models.json `kws-zipformer-en`). */
export const SPOTTER_FILES = {
  encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
  tokens: 'tokens.txt',
  pieces: 'bpe.model',
} as const;

const SAMPLE_RATE = 16_000;
/** 80 ms frames, like the other on-device wake engines. */
const FRAME = 1280;
const DEBOUNCE_MS = 2000;
/** Calibration levels, most strict first (thresholds are a minimum keyword probability). */
export const SPOTTER_LEVELS = [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05] as const;
const MIN_LEVEL = 0.05;
const MAX_LEVEL = 0.5;
/** Names shorter than this only wake as "Hey <name>": a bare "Max" would trip on everyday talk. */
const BARE_NAME_LETTERS = 5;

/**
 * Sensitivity 0..1 (higher = more eager) → keyword threshold. The default 0.6 gives 0.25, where
 * detection plateaued in tests (20 voices: 94 % of "Hey Jarvis" caught, no false wakes in 9 min of
 * talk). A level calibrated from Sir's own recordings can only make it more eager for his voice.
 */
export function spotterThreshold(sensitivity: number, calibrated = 0): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  const t = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, 0.55 - 0.5 * s));
  return calibrated > 0 ? Math.max(MIN_LEVEL, Math.min(t, calibrated)) : t;
}

/** "Hey <name>" and the bare name (when long enough), plus spellings learned while enrolling. */
export function wakePhrases(name: string, learned: readonly string[] = []): string[] {
  const out = new Set<string>();
  for (const n of [name, ...learned]) {
    const words = spotterWords(n);
    if (words[0] === 'HEY') words.shift();
    if (words.length === 0) continue;
    const joined = words.join(' ');
    out.add(`HEY ${joined}`);
    if (joined.replace(/[ ']/g, '').length >= BARE_NAME_LETTERS) out.add(joined);
  }
  return [...out];
}

/** The spotter's keywords file: "▁HE Y ▁JA R VI S #0.25 @HEY_JARVIS", one phrase per line. */
export function keywordsText(
  phrases: readonly string[],
  pieces: Map<string, number>,
  threshold: number,
): string {
  const lines = phrases.flatMap((p) => {
    const split = phrasePieces(p, pieces);
    return split ? [`${split.join(' ')} #${threshold.toFixed(2)} @${p.replace(/ /g, '_')}`] : [];
  });
  if (lines.length === 0)
    throw new JarvisError(
      'INVALID',
      'wake phrase not spellable',
      'The instant wake word knows English letters only. Pick a name written in English letters (Settings → General), or another wake word engine.',
    );
  return `${lines.join('\n')}\n`;
}

/** One running spotter (a seam: tests use a fake). */
export interface KeywordEngine {
  /** 16 kHz samples in [-1, 1] → the phrase heard ("HEY_JARVIS"), or ''. */
  accept(samples: Float32Array): string;
  /** Forget the audio so far (a fresh stream). */
  reset(): void;
}

export interface SpotterModel {
  pieces: Map<string, number>;
  open(keywords: string): Promise<KeywordEngine>;
}

let opened = 0;

/** Loads the downloaded model folder. */
export async function loadSpotterModel(dir: string): Promise<SpotterModel> {
  const pieces = readWordPieces(await readFile(join(dir, SPOTTER_FILES.pieces)));
  // sherpa-onnx ships an older onnxruntime.dll than onnxruntime-node. Windows reuses a DLL that is
  // already loaded by name, so load Jarvis's (newer, backward compatible) one first; the other
  // order would leave onnxruntime-node (Whisper, Kokoro, Silero) on the older runtime.
  await import('onnxruntime-node');
  const mod = (await import('sherpa-onnx-node')) as typeof Sherpa & { default?: typeof Sherpa };
  const KeywordSpotter = mod.KeywordSpotter ?? mod.default?.KeywordSpotter;
  return {
    pieces,
    async open(keywords) {
      // The spotter reads its keywords from a file, once, while it is created.
      const file = join(dir, `keywords-${process.pid}-${opened++}.txt`);
      await writeFile(file, keywords);
      let spotter: InstanceType<typeof KeywordSpotter>;
      try {
        spotter = new KeywordSpotter({
          featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
          modelConfig: {
            transducer: {
              encoder: join(dir, SPOTTER_FILES.encoder),
              decoder: join(dir, SPOTTER_FILES.decoder),
              joiner: join(dir, SPOTTER_FILES.joiner),
            },
            tokens: join(dir, SPOTTER_FILES.tokens),
            numThreads: 1,
            provider: 'cpu',
            debug: 0,
          },
          keywordsFile: file,
          maxActivePaths: 4,
          numTrailingBlanks: 1,
        });
      } finally {
        await rm(file, { force: true });
      }
      let stream = spotter.createStream();
      return {
        accept(samples) {
          stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
          let heard = '';
          while (spotter.isReady(stream)) {
            spotter.decode(stream);
            const keyword = spotter.getResult(stream).keyword;
            if (keyword) {
              heard = keyword;
              spotter.reset(stream);
            }
          }
          return heard;
        },
        reset() {
          stream = spotter.createStream();
        },
      };
    },
  };
}

/** The spotter as a wake word: 80 ms frames in, true once per phrase heard. */
export function createSpotterWake(
  engine: KeywordEngine,
  opts: { now?(): number; onHeard?(phrase: string): void } = {},
): WakeWord {
  const now = opts.now ?? Date.now;
  let lastFire = -Infinity;
  return {
    frameLength: FRAME,
    process(frame) {
      const samples = new Float32Array(frame.length);
      for (let i = 0; i < frame.length; i++) samples[i] = (frame[i] as number) / 32768;
      const heard = engine.accept(samples);
      if (!heard || now() - lastFire < DEBOUNCE_MS) return false;
      lastFire = now();
      opts.onHeard?.(heard);
      return true;
    },
    release() {
      // Native memory goes with the spotter object; nothing else is held.
    },
  };
}

/** Feeds one recorded phrase, with the quiet before and after a live one has, in 80 ms frames. */
function heardIn(engine: KeywordEngine, audio: Float32Array): boolean {
  engine.reset();
  const padded = new Float32Array(SAMPLE_RATE * 0.3 + audio.length + SAMPLE_RATE * 0.6);
  padded.set(audio, SAMPLE_RATE * 0.3);
  let heard = false;
  for (let at = 0; at < padded.length; at += FRAME)
    if (engine.accept(padded.subarray(at, at + FRAME))) heard = true;
  return heard;
}

/**
 * ADR-044 calibration from the Voice Match phrases: for each recording, the strictest level at
 * which "Hey <name>" is still heard (0 = not even at the most eager level).
 */
export function createCalibrator(model: SpotterModel, phrases: readonly string[]) {
  let engines: Promise<KeywordEngine[]> | null = null;
  const all = (): Promise<KeywordEngine[]> =>
    (engines ??= Promise.all(
      SPOTTER_LEVELS.map((level) => model.open(keywordsText(phrases, model.pieces, level))),
    ));
  return {
    async level(audio: Float32Array): Promise<number> {
      const list = await all();
      for (let i = 0; i < list.length; i++)
        if (heardIn(list[i] as KeywordEngine, audio)) return SPOTTER_LEVELS[i] as number;
      return 0;
    },
  };
}

/**
 * The level that still hears all but one of Sir's recordings (one bad take is forgiven when there
 * are four or more); 0 when that isn't reachable, which leaves the sensitivity setting alone.
 */
export function calibratedLevel(levels: readonly number[]): number {
  if (levels.length === 0) return 0;
  const sorted = [...levels].sort((a, b) => a - b);
  const kept = sorted.length >= 4 ? sorted.slice(1) : sorted;
  return kept[0] ?? 0;
}
