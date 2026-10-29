import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sleep } from '@main/lib/util';
import { createLocalEngines } from '@main/voice/local/local-engines';
import { createModelStore } from '@main/voice/local/model-store';
import type { Recorder } from '@main/voice/types';
import { v2LocalModel } from '@main/voice/v2/policy';
import { createVoiceSystem, realFactories } from '@main/voice/voice-system';
import { idle, setupServices } from './helpers';

/**
 * Voice v2 end to end with the real models: a microphone that plays an Indian-English
 * "Hey Jarvis" then "What's the weather in Hyderabad today?" (Edge neural voice), through v2's wake words, the voice
 * detector and on-device speech, must become a voice turn with those words. Skipped unless:
 *   $env:JARVIS_VOICE_BENCH = folder with the bench WAVs (see voice-bench.real.test.ts)
 *   $env:JARVIS_VOICE_MODELS_ROOT = "$env:APPDATA\Jarvis" (holds models\)
 */
const BENCH = process.env['JARVIS_VOICE_BENCH'] ?? '';
const ROOT = process.env['JARVIS_VOICE_MODELS_ROOT'] ?? '';

function wavPcm(file: string): Int16Array {
  const b = readFileSync(join(BENCH, file)).subarray(44);
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~1)));
}

/** A microphone playing `audio` (then silence) at 4× real time, in the frame size asked for. */
function playingMic(audio: Int16Array, frameLength: number): Recorder {
  let at = 0;
  let on = false;
  return {
    frameLength,
    start: () => void (on = true),
    stop: () => void (on = false),
    release: () => void (on = false),
    get isRecording() {
      return on;
    },
    async read() {
      await sleep((frameLength / 16000) * 250);
      if (!on) throw new Error('stopped');
      const f = new Int16Array(frameLength);
      if (at < audio.length) f.set(audio.subarray(at, at + frameLength));
      at += frameLength;
      return f;
    },
  };
}

describe.skipIf(!BENCH || !ROOT)('voice v2 end to end (real models)', () => {
  it.each(['en-IN-PrabhatNeural', 'en-IN-NeerjaNeural', 'en-GB-RyanNeural', 'en-US-GuyNeural'])(
    '"Hey Jarvis" + a request in %s becomes a voice turn',
    { timeout: 120_000 },
    async (voice) => {
      const t = setupServices({
        rules: [{ match: 'weather', steps: [{ text: '<spoken>Sunny, sir.</spoken>' }] }],
      });
      const s = t.services;
      s.settings.set('voice.engine', 'v2');
      s.settings.set('voice.mode', 'wake');
      s.settings.set('voice.greet', false);
      const store = createModelStore({ root: join(ROOT, 'models'), onProgress: () => undefined });
      const local = createLocalEngines(store, s.settings, {
        sttModel: () => v2LocalModel((id) => store.installed(id)),
      });
      const real = realFactories(s, local, store);
      const silence = (ms: number) => new Int16Array((16000 * ms) / 1000);
      const parts = [
        silence(1000),
        wavPcm(`wake-0-${voice}.wav`),
        silence(300),
        wavPcm(`cmd-0-${voice}.wav`),
        silence(3000),
      ];
      const audio = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
      let at = 0;
      for (const p of parts) {
        audio.set(p, at);
        at += p.length;
      }
      const v = createVoiceSystem(s, {
        factories: { ...real, recorder: (_d, n) => playingMic(audio, n) },
      });
      expect(await v.start()).toEqual({ ok: true });
      const start = Date.now();
      while (s.conversations.list(5).length === 0 && Date.now() - start < 90_000) await sleep(100);
      await idle(s);
      v.voice.shutdown();
      const conv = s.conversations.list(5)[0];
      const said = conv
        ? s.conversations.messages(conv.id).find((m) => m.role === 'user')?.text_plain
        : '';
      console.log('heard:', said);
      // The pipeline, not the model: a city name may come out spelled oddly ("Hydra about").
      expect(said?.toLowerCase()).toMatch(/weather in .+ today/);
    },
  );
});
