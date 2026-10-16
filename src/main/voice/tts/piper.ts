import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PiperVoice } from '@shared/speech-engines';
import { JarvisError } from '../../errors';
import { inference } from '../../inference/client';
import type { TtsChunk, TtsProvider } from '../types';
import { encodeWav } from '../wav';
import { espeakIpa, findEspeak, realEspeak, speedFromRate, type RunEspeak } from './kokoro';

/**
 * ADR-038: Piper voices (VITS, rhasspy/piper-voices) on onnxruntime-node in the model process.
 * Text → eSpeak NG IPA (Sir's installed espeak-ng.exe, as for Kokoro) → the voice's phoneme ids →
 * audio. Written from the published voice format (voice.onnx.json); no Piper code is used (its
 * current repo is GPL-3.0).
 */

export interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference?: { noise_scale?: number; length_scale?: number; noise_w?: number };
  phoneme_id_map: Record<string, number[]>;
  num_speakers?: number;
}

/** Piper's markers: start (^), end ($) and the pad (_) placed after every phoneme. */
const BOS = '^';
const EOS = '$';
const PAD = '_';
/** eSpeak marks a switch of language like "(en)"; those letters are not phonemes. */
const LANG_SWITCH = /\([a-z]{2,3}(-[a-z0-9]+)*\)/gi;

/** VITS output is quiet and varies by voice: scale the peak to just under full level. */
export function normalise(wave: Float32Array): Float32Array {
  let peak = 0.01;
  for (const x of wave) peak = Math.max(peak, Math.abs(x));
  const gain = 0.95 / peak;
  return wave.map((x) => x * gain);
}

/** Keeps one call well inside the model's comfort zone; the pipeline already sends one sentence. */
const MAX_PHONEMES = 1000;

export function parsePiperConfig(raw: string): PiperConfig {
  const c = JSON.parse(raw) as Partial<PiperConfig>;
  const rate = c.audio?.sample_rate;
  const map = c.phoneme_id_map;
  if (
    !Number.isInteger(rate) ||
    (rate as number) < 8000 ||
    (rate as number) > 48_000 ||
    typeof c.espeak?.voice !== 'string' ||
    !map ||
    typeof map !== 'object' ||
    !Object.values(map).every((ids) => Array.isArray(ids) && ids.every(Number.isInteger))
  )
    throw new Error('Piper voice config is incomplete');
  return c as PiperConfig;
}

/**
 * IPA → ids as Piper voices expect: ^ _ p₁ _ p₂ _ … $. Characters the voice doesn't know are tried
 * as their decomposed parts (NFD), then dropped.
 */
export function phonemeIds(ipa: string, map: Record<string, number[]>): number[] {
  const pad = map[PAD] ?? [0];
  const ids: number[] = [...(map[BOS] ?? []), ...pad];
  let count = 0;
  for (const ch of ipa) {
    const parts = map[ch] ? [ch] : [...ch.normalize('NFD')];
    for (const p of parts) {
      const id = map[p];
      if (!id || count >= MAX_PHONEMES) continue;
      ids.push(...id, ...pad);
      count++;
    }
  }
  ids.push(...(map[EOS] ?? []));
  return ids;
}

interface Loaded {
  config: PiperConfig;
  modelPath: string;
}

/** `modelDir(voice)` is models/<voice> holding voice.onnx and voice.onnx.json. */
export function createPiperTts(deps: {
  modelDir: (voice: PiperVoice) => string;
  installed: (voice: PiperVoice) => boolean;
  voice: () => PiperVoice;
  espeakPath?: () => string | null;
  runEspeak?: RunEspeak;
  run?: typeof inference;
}): TtsProvider {
  const loaded = new Map<PiperVoice, Promise<Loaded>>();
  const models = deps.run ?? inference;

  function load(voice: PiperVoice): Promise<Loaded> {
    let p = loaded.get(voice);
    if (!p) {
      const dir = deps.modelDir(voice);
      p = readFile(join(dir, 'voice.onnx.json'), 'utf8').then((raw) => ({
        config: parsePiperConfig(raw),
        modelPath: join(dir, 'voice.onnx'),
      }));
      p.catch(() => loaded.delete(voice));
      loaded.set(voice, p);
    }
    return p;
  }

  return {
    id: 'piper',
    async *synthesize(text, { rate, signal }) {
      const voice = deps.voice();
      if (!deps.installed(voice))
        throw new JarvisError(
          'INVALID',
          'piper voice not downloaded',
          'Download the Piper voice in Settings → Voice first.',
        );
      const espeak = (deps.espeakPath ?? findEspeak)();
      if (!espeak)
        throw new JarvisError(
          'INVALID',
          'espeak-ng missing',
          'Piper voices need eSpeak NG (free). Install it from github.com/espeak-ng/espeak-ng/releases.',
        );
      const { config, modelPath } = await load(voice);
      const ipa = (
        await espeakIpa(text, config.espeak.voice, espeak, deps.runEspeak ?? realEspeak, signal)
      ).replace(LANG_SWITCH, '');
      if (!ipa.trim() || signal.aborted) return;
      const inf = config.inference ?? {};
      const wave = await models().piperRun({
        modelPath,
        ids: BigInt64Array.from(phonemeIds(ipa, config.phoneme_id_map).map(BigInt)),
        // A higher speed is a shorter length scale.
        scales: new Float32Array([
          inf.noise_scale ?? 0.667,
          (inf.length_scale ?? 1) / speedFromRate(rate),
          inf.noise_w ?? 0.8,
        ]),
        ...((config.num_speakers ?? 1) > 1 ? { speakerId: 0 } : {}),
      });
      if (signal.aborted) return;
      yield {
        mime: 'audio/wav',
        data: encodeWav(normalise(wave), config.audio.sample_rate),
      } satisfies TtsChunk;
    },
  };
}
