import { describe, expect, it } from 'vitest';
import { createKokoroTts, findEspeak } from '@main/voice/tts/kokoro';

/**
 * The real Kokoro model and eSpeak NG on CPU. Skipped unless JARVIS_KOKORO_DIR points at the
 * downloaded folder, e.g.
 *   $env:JARVIS_KOKORO_DIR="$env:APPDATA\Jarvis\models\kokoro-82m"; npx vitest run tests/integration/kokoro.real.test.ts
 */
const DIR = process.env['JARVIS_KOKORO_DIR'] ?? '';

describe.skipIf(!DIR || !findEspeak())('Kokoro (real model)', () => {
  it('speaks a sentence as a 24 kHz WAV of plausible length', { timeout: 120_000 }, async () => {
    const tts = createKokoroTts({
      modelDir: () => DIR,
      installed: () => true,
      voice: () => 'bm_george',
    });
    const chunks: Uint8Array[] = [];
    const t0 = Date.now();
    for await (const c of tts.synthesize(
      'Good evening, sir. Your three o’clock has moved to half past four.',
      {
        voice: '',
        rate: '+0%',
        signal: new AbortController().signal,
      },
    ))
      chunks.push(c.data);
    const wav = Buffer.from(chunks[0] ?? new Uint8Array());
    const seconds = (wav.length - 44) / 2 / 24_000;
    console.info(
      `kokoro: ${seconds.toFixed(2)} s of audio in ${Date.now() - t0} ms (first call includes loading)`,
    );
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(10);
  });
});
