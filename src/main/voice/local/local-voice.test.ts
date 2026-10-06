import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalEngines } from './local-engines';
import { createWhisperStt } from './local-stt';
import { createModelStore, MODEL_IDS, type ModelId, type Progress } from './model-store';
import type { Vad } from './onnx';
import { createOpenWakeWord, OWW_CHUNK, thresholdFor, type OwwModels } from './open-wake-word';
import { cleanTranscript } from './whisper';

// ── openWakeWord pipeline ──────────────────────────────────────────────────────────────────
function fakeOww(scoreAt: (call: number) => number) {
  const calls = { mel: [] as number[], embed: [] as Float32Array[], classify: 0, released: false };
  const models: OwwModels = {
    async mel(audio) {
      calls.mel.push(audio.length);
      return new Float32Array(8 * 32).fill(10); // 8 frames, → 10/10 + 2 = 3 after the transform
    },
    async embed(window) {
      calls.embed.push(window);
      return new Float32Array(96).fill(0.5);
    },
    async classify() {
      return scoreAt(++calls.classify);
    },
    release: () => {
      calls.released = true;
    },
  };
  return { models, calls };
}

describe('openWakeWord port (ADR-011)', () => {
  it('works in 80 ms chunks whatever the mic frame size, with 480 samples of context', async () => {
    const { models, calls } = fakeOww(() => 0);
    const ww = createOpenWakeWord(models, 0.5);
    expect(ww.frameLength).toBe(OWW_CHUNK);
    for (let i = 0; i < 5; i++) await ww.process(new Int16Array(512)); // 2560 samples = 2 chunks
    expect(calls.mel).toEqual([1280, 1760]);
    // First window: 68 rows of the initial ones, then 8 transformed frames (3).
    const w = calls.embed[0] as Float32Array;
    expect(w.length).toBe(76 * 32);
    expect(w[0]).toBe(1);
    expect(w.at(-1)).toBe(3);
  });

  it('needs 16 embeddings, ignores 5 warm-up predictions, then fires once above threshold and debounces', async () => {
    let t = 0;
    const { models, calls } = fakeOww(() => 0.9);
    const ww = createOpenWakeWord(models, 0.5, () => t);
    const fired: number[] = [];
    for (let chunk = 1; chunk <= 50; chunk++) {
      t += 80;
      if (await ww.process(new Int16Array(OWW_CHUNK))) fired.push(chunk);
    }
    expect(calls.classify).toBe(50 - 15 - 5); // classifier runs from chunk 16, first 5 are warm-up
    expect(fired).toEqual([21, 21 + 25]); // then again only after the 2 s debounce (25 chunks)
    ww.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.released).toBe(true);
    expect(await ww.process(new Int16Array(OWW_CHUNK))).toBe(false); // released: no more inference
  });

  it('waits for a running inference before releasing the models', async () => {
    let finish: () => void = () => undefined;
    const { models, calls } = fakeOww(() => 0);
    const slow: OwwModels = {
      ...models,
      mel: (a) => new Promise((r) => (finish = () => r(models.mel(a)))),
    };
    const ww = createOpenWakeWord(slow, 0.5);
    const pending = ww.process(new Int16Array(OWW_CHUNK));
    ww.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.released).toBe(false);
    finish();
    await pending;
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.released).toBe(true);
  });

  it('maps Picovoice-style sensitivity to a bounded threshold', () => {
    expect(thresholdFor(0.6)).toBeCloseTo(0.5);
    expect(thresholdFor(1)).toBe(0.2);
    expect(thresholdFor(0)).toBe(0.9);
  });
});

const rep = (n: number, v: number): number[] => new Array<number>(n).fill(v);

// ── Whisper session (VAD segmentation) ──────────────────────────────────────────────────────
function scriptedVad(probs: number[]): Vad {
  let i = 0;
  return { prob: async () => probs[i++] ?? 0, reset: () => undefined };
}

async function runSession(
  probs: number[],
  opts: { text?: string; frames?: number; fail?: boolean } = {},
) {
  const heard: Float32Array[] = [];
  const stt = createWhisperStt({
    vad: async () => scriptedVad(probs),
    transcriber: async () => ({
      async transcribe(audio) {
        if (opts.fail) throw new Error('model crashed');
        heard.push(audio);
        return opts.text ?? 'what time is it';
      },
      release: async () => undefined,
    }),
  });
  const s = await stt.start({
    sampleRate: 16000,
    language: 'en',
    signal: new AbortController().signal,
  });
  const events: string[] = [];
  s.on('speechStarted', () => events.push('start'));
  s.on('final', (t) => events.push(`final:${t}`));
  s.on('utteranceEnd', () => events.push('end'));
  s.on('error', (e) => events.push(`error:${e.message}`));
  const frame = new Int16Array(1280).fill(16384);
  for (let i = 0; i < (opts.frames ?? 40); i++) s.write(frame);
  await new Promise((r) => setTimeout(r, 20));
  return { events, heard, session: s };
}

describe('Whisper speech-to-text session', () => {
  it('starts on speech, ends after 700 ms of quiet, and transcribes with pre-roll', async () => {
    // 12 quiet windows, 20 speech windows, then quiet (22 windows ≈ 700 ms ends it).
    const probs = [...rep(12, 0.1), ...rep(20, 0.9), ...rep(40, 0.05)];
    const { events, heard } = await runSession(probs, { frames: 60 });
    expect(events).toEqual(['start', 'final:what time is it', 'end']);
    // 10 pre-roll windows + 20 speech windows... minus the trigger window counted once, + 22 quiet.
    expect(heard[0]?.length).toBe((10 + 19 + 22) * 512);
    expect(heard[0]?.[0]).toBeCloseTo(0.5);
  });

  it('sends nothing while it never hears speech, and reports transcription errors', async () => {
    expect((await runSession([], { frames: 20 })).events).toEqual([]);
    const failing = await runSession([0.9, ...rep(40, 0)], { fail: true, frames: 20 });
    expect(failing.events).toEqual(['start', 'error:model crashed']);
  });

  it('ends with no final when Whisper only heard noise', async () => {
    const { events } = await runSession([0.9, ...rep(40, 0)], { text: '', frames: 20 });
    expect(events).toEqual(['start', 'end']);
  });

  it('drops classic Whisper hallucinations on very short audio', () => {
    expect(cleanTranscript(' Thank you. ', 0.8)).toBe('');
    expect(cleanTranscript('[BLANK_AUDIO]', 1)).toBe('');
    expect(cleanTranscript('Thank you.', 3)).toBe('Thank you.');
    expect(cleanTranscript('  open   notepad ', 1)).toBe('open notepad');
  });
});

// ── model store ─────────────────────────────────────────────────────────────────────────────
const body = (text: string) => new Response(new TextEncoder().encode(text));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function manifestWith(files: Record<string, string>) {
  const entry = (name: string, content: string) => ({
    path: name,
    url: `https://models.example/${name}`,
    sha256: sha(content),
    size: Buffer.byteLength(content),
  });
  const m = Object.fromEntries(
    MODEL_IDS.map((id) => [id, { files: [] as ReturnType<typeof entry>[] }]),
  );
  for (const [key, content] of Object.entries(files)) {
    const [id, name] = key.split(':') as [ModelId, string];
    m[id]?.files.push(entry(name, content));
  }
  return m as Record<ModelId, { files: Array<ReturnType<typeof entry>> }>;
}

describe('model store (pinned downloads)', () => {
  it('downloads a model and its VAD, verifying every hash', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-models-'));
    const files = {
      'whisper-base.en:onnx/enc.onnx': 'ENCODER',
      'silero-vad:silero_vad.onnx': 'VAD',
    };
    const progress: Progress[] = [];
    const fetched: string[] = [];
    const store = createModelStore({
      root,
      onProgress: (p) => progress.push(p),
      manifest: manifestWith(files),
      fetch: (async (url: string) => {
        fetched.push(url);
        return body(url.endsWith('enc.onnx') ? 'ENCODER' : 'VAD');
      }) as typeof fetch,
    });
    expect(store.status()['whisper-base.en']).toMatchObject({ installed: false, sizeBytes: 10 });
    await store.download('whisper-base.en');
    expect(fetched).toHaveLength(2);
    expect(store.installed('whisper-base.en')).toBe(true);
    expect(progress.at(-1)).toMatchObject({ id: 'whisper-base.en', done: true, receivedBytes: 10 });
    await store.download('whisper-base.en'); // nothing left to fetch
    expect(fetched).toHaveLength(2);
    await store.remove('whisper-base.en');
    expect(existsSync(store.dir('whisper-base.en'))).toBe(false);
  });

  it('rejects a tampered file and leaves nothing behind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-models-'));
    const progress: Progress[] = [];
    const store = createModelStore({
      root,
      onProgress: (p) => progress.push(p),
      manifest: manifestWith({ 'openwakeword-hey-jarvis:hey.onnx': 'GOOD' }),
      fetch: async () => body('EVIL'),
    });
    await expect(store.download('openwakeword-hey-jarvis')).rejects.toMatchObject({
      userMessage: /integrity check/,
    });
    expect(readdirSync(store.dir('openwakeword-hey-jarvis'))).toEqual([]);
    expect(progress.at(-1)?.error).toMatch(/integrity/);
  });

  it('local engines explain what to download when a model is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-models-'));
    const store = createModelStore({ root, onProgress: () => undefined });
    const settings = {
      get: (k: string) => (k === 'voice.stt.whisperModel' ? 'whisper-small.en' : 'whisper'),
    };
    const local = createLocalEngines(store, settings as never);
    await expect(local.wake(0.6)).rejects.toMatchObject({
      userMessage: /Hey Jarvis" wake-word model/,
    });
    await expect(
      local.stt.start({ sampleRate: 16000, language: 'en', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ userMessage: /Download the Whisper model/ });
  });
});
