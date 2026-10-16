import { describe, expect, it, vi } from 'vitest';
import type * as fsp from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createPiperTts, parsePiperConfig, phonemeIds } from './piper';
import type { InferenceOps } from '../../inference/engines';

vi.mock('node:fs/promises', async (orig) => ({
  ...(await orig<typeof fsp>()),
  readFile: vi.fn(),
}));

const MAP: Record<string, number[]> = {
  _: [0],
  '^': [1],
  $: [2],
  ' ': [3],
  h: [20],
  ə: [59],
  ˈ: [120],
  ', ': [],
};
const CONFIG = JSON.stringify({
  audio: { sample_rate: 22050 },
  espeak: { voice: 'en-gb-x-rp' },
  inference: { noise_scale: 0.6, length_scale: 1, noise_w: 0.8 },
  phoneme_id_map: MAP,
  num_speakers: 1,
});
const signal = new AbortController().signal;

describe('Piper voices (ADR-038)', () => {
  it('builds ids as ^ _ p _ p _ $ and drops phonemes the voice lacks', () => {
    expect(phonemeIds('hə', MAP)).toEqual([1, 0, 20, 0, 59, 0, 2]);
    expect(phonemeIds('h✓', MAP)).toEqual([1, 0, 20, 0, 2]);
  });

  it('tries a composed character as its parts', () => {
    // "é" is not in the map; its NFD parts are "e" + U+0301.
    expect(phonemeIds('é', { ...MAP, e: [7], '\u0301': [8] })).toEqual([1, 0, 7, 0, 8, 0, 2]);
  });

  it('rejects a config without the fields it needs', () => {
    expect(() => parsePiperConfig('{"audio":{}}')).toThrow('incomplete');
    expect(parsePiperConfig(CONFIG).espeak.voice).toBe('en-gb-x-rp');
  });

  it('phonemizes with the voice’s eSpeak language and speeds up by shortening the length scale', async () => {
    vi.mocked(readFile).mockResolvedValue(CONFIG);
    const piperRun = vi.fn(async () => new Float32Array([0, 0.5, -0.5]));
    // eSpeak's "(en)" language-switch markers are not phonemes.
    const runEspeak = vi.fn(async () => '(en)hˈə(hi)\n');
    const tts = createPiperTts({
      modelDir: (v) => `C:/models/${v}`,
      installed: () => true,
      voice: () => 'piper-en_GB-alan-medium',
      espeakPath: () => 'espeak.exe',
      runEspeak,
      run: () => ({ piperRun }) as unknown as InferenceOps,
    });
    const out = [];
    for await (const c of tts.synthesize('Hello', { voice: '', rate: '+25%', signal })) out.push(c);
    expect(runEspeak).toHaveBeenCalledWith(
      'espeak.exe',
      ['-q', '--ipa', '-v', 'en-gb-x-rp', '--', 'Hello'],
      signal,
    );
    const req = (
      piperRun.mock.calls[0] as unknown as [{ scales: Float32Array; modelPath: string }]
    )[0];
    expect(req.modelPath.replace(/\\/g, '/')).toBe('C:/models/piper-en_GB-alan-medium/voice.onnx');
    expect(req.scales[1]).toBeCloseTo(0.8);
    expect([...(req as unknown as { ids: BigInt64Array }).ids].map(Number)).toEqual([
      1, 0, 20, 0, 120, 0, 59, 0, 2,
    ]);
    expect(out[0]?.mime).toBe('audio/wav');
    // The WAV carries the voice's own sample rate.
    expect(Buffer.from(out[0]!.data).readUInt32LE(24)).toBe(22050);
  });

  it('asks for the download first', async () => {
    const tts = createPiperTts({
      modelDir: () => '',
      installed: () => false,
      voice: () => 'piper-te_IN-venkatesh-medium',
      espeakPath: () => 'espeak.exe',
    });
    await expect(
      tts.synthesize('x', { voice: '', signal })[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('piper voice not downloaded');
  });

  it('refuses a voice config naming something that is not an eSpeak voice', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ ...JSON.parse(CONFIG), espeak: { voice: '--path=C:/x' } }),
    );
    const tts = createPiperTts({
      modelDir: () => 'C:/m',
      installed: () => true,
      voice: () => 'piper-en_US-joe-medium',
      espeakPath: () => 'espeak.exe',
      runEspeak: vi.fn(),
    });
    await expect(
      tts.synthesize('x', { voice: '', signal })[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('not an eSpeak voice');
  });
});
