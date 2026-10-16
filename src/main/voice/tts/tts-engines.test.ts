import { describe, expect, it, vi } from 'vitest';
import { createElevenLabsTts } from './elevenlabs';
import {
  cleanPhonemes,
  createKokoroTts,
  encodeWav,
  findEspeak,
  phonemize,
  speedFromRate,
  splitRuns,
  tokenize,
} from './kokoro';

const signal = new AbortController().signal;
const firstChunk = (it: AsyncIterable<unknown>): Promise<unknown> =>
  it[Symbol.asyncIterator]().next();

describe('Kokoro on-device voice', () => {
  it('finds eSpeak NG in Program Files before PATH, and never from a setting', () => {
    const exists = (p: string): boolean => p === 'C:\\Program Files\\eSpeak NG\\espeak-ng.exe';
    expect(findEspeak({ ProgramFiles: 'C:\\Program Files', PATH: 'C:\\bin' }, exists)).toBe(
      'C:\\Program Files\\eSpeak NG\\espeak-ng.exe',
    );
    expect(findEspeak({ PATH: 'C:\\bin' }, () => false)).toBeNull();
  });

  it('keeps punctuation between speakable runs so Kokoro hears the pauses', () => {
    expect(splitRuns('Good evening, sir. Ready?')).toEqual([
      { speak: true, text: 'Good evening' },
      { speak: false, text: ', ' },
      { speak: true, text: 'sir' },
      { speak: false, text: '. ' },
      { speak: true, text: 'Ready' },
      { speak: false, text: '?' },
    ]);
  });

  it('maps eSpeak phonemes to Kokoro’s set', () => {
    expect(cleanPhonemes(' rˈɛd  lˈɒx ')).toBe('ɹˈɛd lˈɒk');
  });

  it('phonemizes a sentence in one eSpeak run (one line per clause)', async () => {
    const run = vi.fn(async () => ' ɡˈʊd ˈiːvnɪŋ\r\n sˈɜː\r\n');
    const ps = await phonemize('Good evening, sir.', 'en-gb', 'espeak.exe', run, signal);
    expect(ps).toBe('ɡˈʊd ˈiːvnɪŋ, sˈɜː.');
    expect(run).toHaveBeenCalledTimes(1);
    // Arguments go to execFile as an array, after "--" so text can't become a flag.
    expect(run).toHaveBeenCalledWith(
      'espeak.exe',
      ['-q', '--ipa', '-v', 'en-gb', '--', 'Good evening.\nsir'],
      signal,
    );
  });

  it('falls back to one run per clause when eSpeak splits differently', async () => {
    const run = vi.fn(async (_e: string, args: string[]) =>
      args.at(-1)?.includes('\n') ? 'a b c\n' : `[${args.at(-1)}]\n`,
    );
    const ps = await phonemize('one, two', 'en-us', 'e', run, signal);
    expect(ps).toBe('[one], [two]');
  });

  it('tokenizes with boundary tokens and drops unknown characters', () => {
    expect(tokenize('ab?', { a: 43, b: 44, '?': 6 })).toEqual([0, 43, 44, 6, 0]);
    expect(tokenize('aZ', { a: 43 })).toEqual([0, 43, 0]);
  });

  it('writes a valid 24 kHz 16-bit WAV', () => {
    const wav = Buffer.from(encodeWav(new Float32Array([0, 1, -1, 2]), 24_000));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readInt16LE(46)).toBe(32767);
    expect(wav.readInt16LE(50)).toBe(32767);
    expect(wav.length).toBe(44 + 8);
  });

  it('turns the rate setting into a clamped speed', () => {
    expect(speedFromRate('+5%')).toBeCloseTo(1.05);
    expect(speedFromRate('-80%')).toBe(0.7);
    expect(speedFromRate(undefined)).toBe(1);
  });

  it('refuses clearly when the model or eSpeak is missing (the pipeline then uses Edge)', async () => {
    const notDownloaded = createKokoroTts({
      modelDir: () => '',
      installed: () => false,
      voice: () => 'bm_george',
    });
    await expect(
      firstChunk(notDownloaded.synthesize('Hi there sir', { voice: '', signal })),
    ).rejects.toThrow(/kokoro not downloaded/);
    const noEspeak = createKokoroTts({
      modelDir: () => '',
      installed: () => true,
      voice: () => 'bm_george',
      espeakPath: () => null,
    });
    await expect(
      firstChunk(noEspeak.synthesize('Hi there sir', { voice: '', signal })),
    ).rejects.toThrow(/espeak-ng missing/);
  });
});

describe('ElevenLabs cloud voice', () => {
  const collect = async (it: AsyncIterable<{ data: Uint8Array }>): Promise<number> => {
    let n = 0;
    for await (const c of it) n += c.data.length;
    return n;
  };

  it('posts the sentence to the chosen voice and model with the key in a header', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const tts = createElevenLabsTts({
      key: () => 'sk_test',
      voiceId: () => 'onwK4e9ZLuTAKqWW03F9',
      model: () => 'eleven_v4_turbo',
      fetch: fetch,
    });
    expect(
      await collect(tts.synthesize('Good evening, sir.', { voice: '', rate: '+5%', signal })),
    ).toBe(3);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/onwK4e9ZLuTAKqWW03F9/stream?output_format=mp3_44100_128',
    );
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('sk_test');
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Good evening, sir.',
      model_id: 'eleven_v4_turbo',
      voice_settings: { speed: 1.05 },
    });
  });

  it('fails without a key, with a bad voice id, or on an HTTP error', async () => {
    const make = (key: string | undefined, voice: string, status = 200) =>
      createElevenLabsTts({
        key: () => key,
        voiceId: () => voice,
        model: () => 'eleven_flash_v2_5',
        fetch: async () => new Response('x', { status }),
      }).synthesize('Hello there', { voice: '', signal });
    await expect(collect(make(undefined, 'onwK4e9ZLuTAKqWW03F9'))).rejects.toThrow(
      /no elevenlabs key/,
    );
    await expect(collect(make('k', '../../v1/user'))).rejects.toThrow(/bad voice id/);
    await expect(collect(make('k', 'onwK4e9ZLuTAKqWW03F9', 401))).rejects.toThrow(
      /HTTP 401 \(check the API key\)/,
    );
  });
});
