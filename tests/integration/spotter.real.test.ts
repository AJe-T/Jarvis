import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bunzip2 } from '@main/lib/bzip2';
import { readTarFiles } from '@main/lib/tar';
import { createModelStore } from '@main/voice/local/model-store';
import MANIFEST from '@main/voice/local/models.json';
import {
  SPOTTER_FILES,
  createSpotterWake,
  keywordsText,
  loadSpotterModel,
  spotterThreshold,
  wakePhrases,
} from '@main/voice/local/spotter';

/**
 * ADR-044, the real thing: downloads the keyword-spotter model through the model store (GitHub
 * release → bzip2 → tar → per-file SHA-256), loads onnxruntime-node and sherpa-onnx in one
 * process (the two onnxruntime.dll copies), and spots phrases in the model's own recordings.
 * Runs in CI (Windows); locally:
 *   $env:JARVIS_SPOTTER_REAL="1"; npm test -- tests/integration/spotter.real.test.ts
 */
const REAL = process.env['JARVIS_SPOTTER_REAL'] === '1';
const CACHE = process.env['JARVIS_SPOTTER_CACHE'] ?? join(tmpdir(), 'jarvis-spotter-real');
const ARCHIVE = MANIFEST['kws-zipformer-en'].archive;

/** 16-bit PCM mono WAV → floats in [-1, 1]. */
function wavSamples(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  for (let at = 12; at + 8 <= wav.length;) {
    const id = new TextDecoder().decode(wav.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (id === 'data') {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = view.getInt16(at + 8 + i * 2, true) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

describe.skipIf(!REAL)('keyword spotter (real model, ADR-044)', () => {
  it(
    'downloads, coexists with onnxruntime-node and hears phrases in real speech',
    { timeout: 300_000 },
    async () => {
      mkdirSync(CACHE, { recursive: true });
      const store = createModelStore({ root: join(CACHE, 'models'), onProgress: () => undefined });
      await store.download('kws-zipformer-en');
      expect(store.installed('kws-zipformer-en')).toBe(true);
      const dir = store.dir('kws-zipformer-en');

      // The model's own test recordings, out of the same release archive with our readers.
      const res = await fetch(ARCHIVE.url);
      const wavs = await readTarFiles(
        bunzip2(new Uint8Array(await res.arrayBuffer())),
        new Set([`${ARCHIVE.root}/test_wavs/0.wav`, `${ARCHIVE.root}/test_wavs/1.wav`]),
        2_000_000,
      );
      const clip = (n: number): Float32Array =>
        wavSamples(wavs.get(`${ARCHIVE.root}/test_wavs/${n}.wav`) ?? new Uint8Array());

      const model = await loadSpotterModel(dir);
      const engine = await model.open(
        keywordsText(['LIGHT UP', 'LOVELY CHILD', 'FOREVER'], model.pieces, 0.25),
      );
      const heard = (audio: Float32Array): string[] => {
        engine.reset();
        const out: string[] = [];
        const padded = new Float32Array(audio.length + 16000);
        padded.set(audio);
        for (let at = 0; at < padded.length; at += 1280) {
          const k = engine.accept(padded.subarray(at, at + 1280));
          if (k) out.push(k);
        }
        return out;
      };
      // "…the yellow lamps would LIGHT UP here and there…"
      expect(heard(clip(0))).toEqual(['LIGHT_UP']);
      // "…given her a LOVELY CHILD … to connect her parent FOR EVER…"
      expect(heard(clip(1))).toEqual(['LOVELY_CHILD', 'FOREVER']);

      // The wake phrases load, and silence never wakes.
      const wake = createSpotterWake(
        await model.open(keywordsText(wakePhrases('Jarvis'), model.pieces, spotterThreshold(0.6))),
      );
      let woke = false;
      for (let i = 0; i < 50; i++) woke ||= await wake.process(new Int16Array(1280));
      expect(woke).toBe(false);

      // onnxruntime-node still runs a model after sherpa-onnx loaded its own runtime.
      const ort = await import('onnxruntime-node');
      const session = await ort.InferenceSession.create(join(dir, SPOTTER_FILES.joiner));
      expect(session.inputNames.length).toBeGreaterThan(0);
      await session.release();
    },
  );
});
