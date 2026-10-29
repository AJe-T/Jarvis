import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it } from 'vitest';
import { loadOwwModels } from '@main/voice/local/onnx';
import { createOpenWakeWord, thresholdFor } from '@main/voice/local/open-wake-word';
import {
  createSpotterWake,
  keywordsText,
  loadSpotterModel,
  spotterThreshold,
  wakePhrases,
} from '@main/voice/local/spotter';
import { loadWhisper } from '@main/voice/local/whisper';
import { windowsTranscriber } from '@main/voice/stt/cloud-stt';
import type { WakeWord } from '@main/voice/types';
import { createAutoGain } from '@main/voice/v2/gain';

/**
 * Voice v2 test bench: every installed wake word and speech engine on the same recordings (Edge
 * neural voices incl. Indian English, made by scripts/ or by hand), clean, quiet (a laptop mic
 * array without automatic gain) and noisy. Skipped unless both folders are given:
 *   $env:JARVIS_VOICE_BENCH="<folder with manifest.json + WAVs>"
 *   $env:JARVIS_VOICE_MODELS_DIR="$env:APPDATA\Jarvis\models"
 *   npx vitest run tests/integration/voice-bench.real.test.ts
 */
const BENCH = process.env['JARVIS_VOICE_BENCH'] ?? '';
const MODELS = process.env['JARVIS_VOICE_MODELS_DIR'] ?? '';

interface Clip {
  file: string;
  kind: 'wake' | 'cmd' | 'neg';
  text: string;
  voice: string;
}

function pcm(file: string): Float32Array {
  const b = readFileSync(join(BENCH, file));
  const d = b.subarray(44);
  const s = new Int16Array(d.buffer.slice(d.byteOffset, d.byteOffset + (d.length & ~1)));
  return Float32Array.from(s, (x) => x / 32768);
}

type Condition = 'clean' | 'quiet' | 'noisy' | 'agc';
const CONDITIONS: Condition[] = ['clean', 'quiet', 'noisy', 'agc'];

/** The noisy clip through voice v2's automatic gain, frame by frame as the mic loop would. */
function withGain(a: Float32Array): Float32Array {
  const agc = createAutoGain();
  const out = new Float32Array(a.length);
  for (let at = 0; at < a.length; at += 512) {
    const f = Int16Array.from(a.subarray(at, at + 512), (x) =>
      Math.round(Math.max(-1, Math.min(1, x)) * 32767),
    );
    agc.apply(f).forEach((x, i) => (out[at + i] = x / 32768));
  }
  return out;
}

/** clean as made; quiet = 10 % level (an Intel SST array without AGC); noisy = quiet + hiss; agc = noisy through voice v2's gain. */
function condition(a: Float32Array, c: Condition): Float32Array {
  if (c === 'clean') return a;
  if (c === 'agc') return withGain(condition(a, 'noisy'));
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Float32Array.from(a, (x) => x * 0.1 + (c === 'noisy' ? rand() * 0.006 : 0));
}

const words = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/\bp\.?m\.?\b/g, 'pm')
    .replace(/\b5\b/g, 'five')
    .replace(/\b6\b/g, 'six')
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Word error rate (edit distance over words / reference length). */
function wer(ref: string, hyp: string): number {
  const r = words(ref);
  const h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array<number>(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++) {
      const row = d[i] as number[];
      const up = d[i - 1] as number[];
      row[j] = Math.min(
        (up[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (up[j - 1] ?? 0) + (r[i - 1] === h[j - 1] ? 0 : 1),
      );
    }
  return r.length ? ((d[r.length] as number[])[h.length] ?? 0) / r.length : 0;
}

function toFrames(a: Float32Array, frame = 1280): Int16Array[] {
  const padded = new Float32Array(8000 + a.length + 16000);
  padded.set(a, 8000);
  const out: Int16Array[] = [];
  for (let at = 0; at + frame <= padded.length; at += frame)
    out.push(
      Int16Array.from(padded.subarray(at, at + frame), (x) =>
        Math.round(Math.max(-1, Math.min(1, x)) * 32767),
      ),
    );
  return out;
}

/** One clip through an engine that was reset first (models stay loaded between clips). */
/** Simulated time, so the engines' 2 s debounce sees audio time, not how fast the bench runs. */
let clock = 0;
const now = (): number => clock;

async function fires(w: WakeWord, a: Float32Array): Promise<boolean> {
  w.reset();
  clock += 10_000;
  let heard = false;
  for (const f of toFrames(a, w.frameLength)) {
    clock += (f.length / 16000) * 1000;
    if (await w.process(f)) heard = true;
  }
  return heard;
}

describe.skipIf(!BENCH || !MODELS)('voice v2 bench (real models)', () => {
  // Read only when the bench runs (the describe body is collected even when skipped).
  let clips: Clip[] = [];
  beforeAll(() => {
    clips = JSON.parse(readFileSync(join(BENCH, 'manifest.json'), 'utf8')) as Clip[];
  });
  const report: Record<string, unknown> = {};

  it(
    'wake words: hits on "Hey Jarvis", false fires on everything else',
    { timeout: 900_000 },
    async () => {
      const spotter = await loadSpotterModel(join(MODELS, 'kws-zipformer-en'));
      const oww = await loadOwwModels(join(MODELS, 'openwakeword-hey-jarvis'));
      const rows: Array<Record<string, unknown>> = [];
      const sensitivities = (process.env['JARVIS_BENCH_SENS'] ?? '0.5,0.6,0.8')
        .split(',')
        .map(Number);
      for (const sens of sensitivities) {
        const engines: Record<string, () => Promise<WakeWord>> = {
          spotter: async () =>
            createSpotterWake(
              await spotter.open(
                keywordsText(wakePhrases('Jarvis'), spotter.pieces, spotterThreshold(sens)),
              ),
              { now },
            ),
          openwakeword: async () =>
            createOpenWakeWord({ ...oww, release: () => undefined }, thresholdFor(sens), now),
        };
        for (const c of CONDITIONS) {
          // Per clip, per engine; 'either' is voice v2's combination.
          const heardBy = new Map<string, Record<string, boolean>>();
          for (const [name, make] of Object.entries(engines)) {
            const w = await make();
            for (const clip of clips) {
              const h = heardBy.get(clip.file) ?? {};
              h[name] = await fires(w, condition(pcm(clip.file), c));
              heardBy.set(clip.file, h);
            }
          }
          for (const name of [...Object.keys(engines), 'either']) {
            const got = (clip: Clip): boolean => {
              const h = heardBy.get(clip.file) ?? {};
              return name === 'either' ? Object.values(h).some(Boolean) : !!h[name];
            };
            const per = (text: string): string => {
              const set = clips.filter((x) => x.kind === 'wake' && x.text === text);
              return `${set.filter(got).length}/${set.length}`;
            };
            const wakes = clips.filter((x) => x.kind === 'wake');
            const others = clips.filter((x) => x.kind !== 'wake');
            rows.push({
              engine: name,
              sens,
              condition: c,
              hit: `${wakes.filter(got).length}/${wakes.length}`,
              heyJarvis: per('Hey Jarvis'),
              heyJarvisExcl: per('Hey Jarvis!'),
              bareJarvis: per('Jarvis'),
              falseFires: `${others.filter(got).length}/${others.length}`,
              falseOn: others
                .filter(got)
                .map((x) => `${x.text} (${x.voice})`)
                .join('; '),
            });
          }
        }
      }
      report['wake'] = rows;
      console.table(rows);
      writeFileSync(join(BENCH, 'report-wake.json'), JSON.stringify(rows, null, 1));
    },
  );

  it('speech to text: word error rate and time per command', { timeout: 1_800_000 }, async () => {
    const cmds = clips.filter((c) => c.kind === 'cmd');
    const engines = [
      'moonshine-tiny',
      'moonshine-base',
      'whisper-base.en',
      'distil-small.en',
      'whisper-small.en',
      'parakeet-ctc-0.6b',
    ];
    const rows: Array<Record<string, unknown>> = [];
    const samples: Record<string, string[]> = {};
    const run = async (name: string, transcribe: (a: Float32Array) => Promise<string>) => {
      for (const c of CONDITIONS) {
        let errs = 0;
        let ms = 0;
        for (const clip of cmds) {
          const a = condition(pcm(clip.file), c);
          const t0 = performance.now();
          const text = await transcribe(a).catch((e: unknown) => `ERROR ${String(e).slice(0, 60)}`);
          ms += performance.now() - t0;
          errs += wer(clip.text, text);
          if (clip.voice === 'en-IN-PrabhatNeural') (samples[`${name}/${c}`] ??= []).push(text);
        }
        rows.push({
          engine: name,
          condition: c,
          wer: `${Math.round((errs / cmds.length) * 100)}%`,
          msPerClip: Math.round(ms / cmds.length),
        });
      }
    };
    for (const id of engines) {
      const t = await loadWhisper(join(MODELS, id), false, 4).catch(() => null);
      if (!t) continue;
      await t.transcribe(new Float32Array(16000), 'en-IN'); // warm-up
      await run(id, (a) => t.transcribe(a, 'en-IN'));
      await t.release();
    }
    const win = windowsTranscriber();
    await run('windows', (a) => win.transcribe(a, 'en-IN'));
    report['stt'] = rows;
    report['sttSamples'] = samples;
    console.table(rows);
    writeFileSync(join(BENCH, 'report.json'), JSON.stringify(report, null, 1));
  });
});
