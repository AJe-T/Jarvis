import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sleep } from '@main/lib/util';
import { runPowerShell } from '@main/tools/powershell';
import { createLocalEngines } from '@main/voice/local/local-engines';
import { createWhisperStt } from '@main/voice/local/local-stt';
import { createModelStore, type ModelId } from '@main/voice/local/model-store';
import { loadOwwModels, loadSileroVad } from '@main/voice/local/onnx';
import { createOpenWakeWord, thresholdFor } from '@main/voice/local/open-wake-word';
import { loadWhisper } from '@main/voice/local/whisper';
import type { Recorder } from '@main/voice/types';
import { createVoiceSystem, realFactories } from '@main/voice/voice-system';
import { idle, setupServices } from './helpers';

/**
 * ADR-011 end-to-end check with the real models (downloads them once). Skipped unless
 * JARVIS_VOICE_MODELS points at a folder to keep them in, e.g.
 *   $env:JARVIS_VOICE_MODELS="$env:TEMP\jarvis-models"; npx vitest run tests/integration/local-voice.real.test.ts
 * Speech is synthesised with Windows SAPI at 16 kHz.
 */
const DIR = process.env['JARVIS_VOICE_MODELS'] ?? '';
const WHISPER = (process.env['JARVIS_WHISPER_MODEL'] ?? 'whisper-base.en') as ModelId;

async function speak(text: string): Promise<Int16Array> {
  const out = join(DIR, `${text.replace(/\W+/g, '-')}.wav`);
  const r = await runPowerShell(
    `Add-Type -AssemblyName System.Speech
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile($P.out, $f); $s.Speak([string]$P.text); $s.Dispose()`,
    { params: { out, text }, timeoutMs: 30_000 },
  );
  if (r.exitCode !== 0) throw new Error(r.stderr);
  const b = readFileSync(out);
  const pcm = b.subarray(b.indexOf('data') + 8);
  return new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length & ~1)));
}

const silence = (ms: number): Int16Array => new Int16Array((16000 * ms) / 1000);
const cat = (...parts: Int16Array[]): Int16Array => {
  const out = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe.skipIf(!DIR)('local voice with real models (ADR-011)', () => {
  const store = createModelStore({ root: join(DIR, 'models'), onProgress: () => undefined });

  it('"Hey Jarvis" fires the wake word; other speech does not', async () => {
    mkdirSync(DIR, { recursive: true });
    await store.download('openwakeword-hey-jarvis');
    const run = async (audio: Int16Array): Promise<boolean> => {
      const ww = createOpenWakeWord(
        await loadOwwModels(store.dir('openwakeword-hey-jarvis')),
        thresholdFor(0.6),
      );
      let fired = false;
      for (let i = 0; i + 512 <= audio.length; i += 512)
        if (await ww.process(audio.subarray(i, i + 512))) fired = true;
      ww.release();
      return fired;
    };
    expect(await run(cat(silence(2000), await speak('Hey Jarvis.'), silence(1000)))).toBe(true);
    expect(
      await run(
        cat(silence(2000), await speak('The weather is sunny with a light breeze.'), silence(1000)),
      ),
    ).toBe(false);
  }, 300_000);

  it(`${WHISPER} transcribes a spoken command after the speaker stops`, async () => {
    await store.download(WHISPER);
    const transcriber = await loadWhisper(store.dir(WHISPER), WHISPER === 'whisper-small');
    const vad = await loadSileroVad(join(store.dir('silero-vad'), 'silero_vad.onnx'));
    const session = await createWhisperStt({
      vad: async () => vad,
      transcriber: async () => transcriber,
    }).start({ sampleRate: 16000, language: 'en', signal: new AbortController().signal });
    const final = new Promise<string>((resolve) => session.on('final', resolve));
    const audio = cat(
      silence(500),
      await speak('What time is it in London right now?'),
      silence(1500),
    );
    const started = Date.now();
    for (let i = 0; i + 1280 <= audio.length; i += 1280) session.write(audio.subarray(i, i + 1280));
    const text = await final;
    process.stdout.write(`\n${WHISPER}: "${text}" in ${Date.now() - started} ms\n`);
    expect(text.toLowerCase()).toMatch(/what time is it in london/);
    await transcriber.release();
  }, 600_000);

  it('wake mode end to end: "Hey Jarvis, what time is it?" in one breath reaches the chat', async () => {
    await store.download('openwakeword-hey-jarvis');
    await store.download(WHISPER);
    const t = setupServices({
      rules: [{ match: 'time', steps: [{ text: 'Half past nine, sir.' }] }],
    });
    const s = t.services;
    s.settings.set('voice.mode', 'wake');
    s.settings.set('voice.wake.provider', 'openwakeword');
    s.settings.set('voice.stt.provider', 'whisper');
    s.settings.set('voice.stt.whisperModel', WHISPER);
    const audio = cat(silence(2500), await speak('Hey Jarvis, what time is it?'), silence(3000));
    // The microphone, played in real time from the synthesised audio.
    const fileRecorder = (frameLength: number): Recorder => {
      let at = 0;
      let on = false;
      return {
        frameLength,
        start: () => (on = true),
        stop: () => (on = false),
        release: () => (on = false),
        get isRecording() {
          return on;
        },
        async read() {
          await sleep((frameLength / 16000) * 1000);
          if (!on) throw new Error('PvRecorder failed to read audio data frame.');
          const frame = new Int16Array(frameLength);
          frame.set(audio.subarray(at, Math.min(at + frameLength, audio.length)));
          at += frameLength;
          return frame;
        },
      };
    };
    const real = realFactories(s, createLocalEngines(store, s.settings), store);
    const v = createVoiceSystem(s, {
      factories: { ...real, recorder: (_d, n) => fileRecorder(n) },
    });
    expect(await v.start()).toEqual({ ok: true });
    await v.voice.applyMode(); // as the settings listener does: must not break the running mic
    const started = Date.now();
    while (!t.events.some((e) => e.event === 'chat:message') && Date.now() - started < 30_000)
      await sleep(100);
    await idle(s, 30_000);
    const said = t.events
      .filter((e) => e.event === 'voice:transcript')
      .map((e) => e.payload as { text: string; isFinal: boolean })
      .filter((p) => p.isFinal && p.text);
    process.stdout.write(`
wake→transcript: ${JSON.stringify(said)}
`);
    expect(said.at(-1)?.text.toLowerCase()).toMatch(/what time is it/);
    v.voice.shutdown();
  }, 300_000);
});
