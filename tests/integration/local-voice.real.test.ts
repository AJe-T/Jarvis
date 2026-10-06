import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPowerShell } from '@main/tools/powershell';
import { createWhisperStt } from '@main/voice/local/local-stt';
import { createModelStore, type ModelId } from '@main/voice/local/model-store';
import { loadOwwModels, loadSileroVad } from '@main/voice/local/onnx';
import { createOpenWakeWord, thresholdFor } from '@main/voice/local/open-wake-word';
import { loadWhisper } from '@main/voice/local/whisper';

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
});
