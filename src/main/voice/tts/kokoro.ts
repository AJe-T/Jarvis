import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { KokoroVoice } from '@shared/voices';
import { JarvisError } from '../../errors';
import { inference } from '../../inference/client';
import type { TtsChunk, TtsProvider } from '../types';
import { encodeWav } from '../wav';

export { encodeWav };

/**
 * On-device neural voice: Kokoro-82M (hexgrad, Apache-2.0), the best-rated open TTS model of its
 * size, run on onnxruntime-node. Text → IPA phonemes via eSpeak NG → Kokoro tokens → 24 kHz audio.
 *
 * Licensing: eSpeak NG is GPL-3.0, so it is NOT bundled. Jarvis runs Sir's own installed
 * espeak-ng.exe as a separate program (execFile, no shell). The phoneme clean-up follows the
 * public behaviour of kokoro-js (Apache-2.0); no code is copied.
 */
const SAMPLE_RATE = 24_000;
const STYLE_DIM = 256;
/** Kokoro's context is 512 tokens including the two boundary tokens. */
const MAX_TOKENS = 510;
/** Kept between phoneme runs so Kokoro hears the pauses. */
const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”()]+\s*)/;

/**
 * eSpeak NG from its installer's folder or PATH. Deliberately not a setting, so a compromised UI
 * can't choose which program Jarvis runs (same rule as findClaudeCode).
 */
export function findEspeak(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const candidates = [
    ...[env['ProgramFiles'], env['ProgramFiles(x86)']]
      .filter((d): d is string => Boolean(d))
      .map((d) => join(d, 'eSpeak NG', 'espeak-ng.exe')),
    ...(env['PATH'] ?? env['Path'] ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((d) => join(d, 'espeak-ng.exe')),
  ];
  return candidates.find((p) => exists(p)) ?? null;
}

/** Splits a sentence into speakable runs and the punctuation between them. */
export function splitRuns(text: string): Array<{ speak: boolean; text: string }> {
  return text
    .split(PUNCT)
    .filter((part) => part.length > 0)
    .map((part) => ({ speak: /[\p{L}\p{N}]/u.test(part) && !PUNCT.test(part), text: part }));
}

/** eSpeak's phoneme set → the one Kokoro was trained on. */
export function cleanPhonemes(ps: string): string {
  return ps
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Characters → Kokoro token ids with the boundary token (0) at both ends; unknown characters dropped. */
export function tokenize(phonemes: string, vocab: Record<string, number>): number[] {
  const ids = [...phonemes]
    .map((c) => vocab[c])
    .filter((x): x is number => x !== undefined)
    .slice(0, MAX_TOKENS);
  return [0, ...ids, 0];
}

/** "+5%" → 1.05, clamped to what still sounds natural. */
export function speedFromRate(rate: string | undefined): number {
  const pct = Number.parseInt(rate ?? '0', 10) || 0;
  return Math.max(0.7, Math.min(1.5, 1 + pct / 100));
}

export type RunEspeak = (exe: string, args: string[], signal: AbortSignal) => Promise<string>;

export const realEspeak: RunEspeak = (exe, args, signal) =>
  new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      { windowsHide: true, timeout: 10_000, signal, encoding: 'utf8', maxBuffer: 1 << 20 },
      (err, stdout) =>
        err ? reject(new Error(`eSpeak NG failed: ${err.message}`)) : resolve(stdout),
    );
  });

/**
 * One eSpeak run for the whole sentence: runs are fed as separate clauses (". " between them),
 * and eSpeak prints one line per clause. If it splits differently, each run gets its own call.
 */
export async function phonemize(
  text: string,
  lang: 'en-gb' | 'en-us',
  exe: string,
  run: RunEspeak,
  signal: AbortSignal,
): Promise<string> {
  return cleanPhonemes(await espeakIpa(text, lang, exe, run, signal));
}

/** eSpeak voice names look like en-gb, hi, te (checked: Piper's config names the voice). */
const ESPEAK_VOICE = /^[a-z]{2,3}(-[a-z0-9]{1,8}){0,3}$/i;

/** eSpeak NG's IPA for each speakable run, with the punctuation between runs kept as written. */
export async function espeakIpa(
  text: string,
  lang: string,
  exe: string,
  run: RunEspeak,
  signal: AbortSignal,
): Promise<string> {
  if (!ESPEAK_VOICE.test(lang)) throw new Error(`not an eSpeak voice: ${lang}`);
  const runs = splitRuns(text);
  const words = runs.filter((r) => r.speak).map((r) => r.text.trim());
  if (words.length === 0) return '';
  const call = (t: string): Promise<string> =>
    run(exe, ['-q', '--ipa', '-v', lang, '--', t], signal);
  const lines = (await call(words.join('.\n')))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const phones =
    lines.length === words.length
      ? lines
      : await Promise.all(words.map(async (w) => (await call(w)).replace(/\s+/g, ' ').trim()));
  let i = 0;
  return runs.map((r) => (r.speak ? (phones[i++] ?? '') : r.text)).join('');
}

interface Engine {
  /** The model runs in the model process (ADR-029); this is its path there. */
  modelPath: string;
  vocab: Record<string, number>;
  voices: Map<string, Float32Array>;
}

/**
 * `modelDir` is models/kokoro-82m (tokenizer.json, onnx/model.onnx, voices/*.bin). The model is
 * loaded on the first sentence and kept; a missing model or eSpeak throws, and the TTS pipeline
 * falls back to the Edge voice.
 */
export function createKokoroTts(deps: {
  modelDir: () => string;
  installed: () => boolean;
  voice: () => KokoroVoice;
  espeakPath?: () => string | null;
  runEspeak?: RunEspeak;
}): TtsProvider {
  let engine: Promise<Engine> | null = null;
  const run = deps.runEspeak ?? realEspeak;

  async function load(): Promise<Engine> {
    const dir = deps.modelDir();
    const modelPath = join(dir, 'onnx', 'model.onnx');
    const [, tokenizer] = await Promise.all([
      inference().kokoroWarm({ modelPath }),
      readFile(join(dir, 'tokenizer.json'), 'utf8'),
    ]);
    const vocab = (JSON.parse(tokenizer) as { model: { vocab: Record<string, number> } }).model
      .vocab;
    return { modelPath, vocab, voices: new Map() };
  }

  async function styleFor(e: Engine, voice: KokoroVoice, tokens: number): Promise<Float32Array> {
    let table = e.voices.get(voice);
    if (!table) {
      const b = await readFile(join(deps.modelDir(), 'voices', `${voice}.bin`));
      table = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      e.voices.set(voice, table);
    }
    // One style vector per input length; longer inputs reuse the last row.
    const row = Math.min(tokens, table.length / STYLE_DIM - 1);
    return table.slice(row * STYLE_DIM, (row + 1) * STYLE_DIM);
  }

  return {
    id: 'kokoro',
    async *synthesize(text, { rate, signal }) {
      if (!deps.installed())
        throw new JarvisError(
          'INVALID',
          'kokoro not downloaded',
          'Download the Kokoro voice in Settings → Voice first.',
        );
      const espeak = (deps.espeakPath ?? findEspeak)();
      if (!espeak)
        throw new JarvisError(
          'INVALID',
          'espeak-ng missing',
          'The Kokoro voice needs eSpeak NG (free). Install it from github.com/espeak-ng/espeak-ng/releases.',
        );
      const voice = deps.voice();
      const phonemes = await phonemize(
        text,
        voice.startsWith('b') ? 'en-gb' : 'en-us',
        espeak,
        run,
        signal,
      );
      if (!phonemes || signal.aborted) return;
      engine ??= load().catch((err: unknown) => {
        engine = null;
        throw err;
      });
      const e = await engine;
      const ids = tokenize(phonemes, e.vocab);
      const wave = await inference().kokoroRun({
        modelPath: e.modelPath,
        inputIds: BigInt64Array.from(ids.map(BigInt)),
        style: await styleFor(e, voice, ids.length - 2),
        speed: speedFromRate(rate),
      });
      if (signal.aborted) return;
      yield { mime: 'audio/wav', data: encodeWav(wave, SAMPLE_RATE) } satisfies TtsChunk;
    },
  };
}
