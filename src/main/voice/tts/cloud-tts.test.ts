import { describe, expect, it, vi } from 'vitest';
import {
  audioMime,
  createAuraTts,
  createGroqTts,
  createOpenAiTts,
  createServerTts,
  splitForLimit,
} from './cloud-tts';

const signal = new AbortController().signal;
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0]);

const bodyOf = (body: RequestInit['body'] | undefined): Record<string, unknown> =>
  JSON.parse(body as string) as Record<string, unknown>;

function capture(body: Uint8Array = MP3, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url as string, init: init ?? {} });
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

async function all(it: AsyncIterable<{ mime: string; data: Uint8Array }>) {
  const out: Array<{ mime: string; data: Uint8Array }> = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('cloud and self-hosted voices (ADR-038)', () => {
  it('splits long text at sentence marks or spaces, never past the limit', () => {
    const text = 'Good evening, sir. The build passed and the installer is ready for you to try.';
    const parts = splitForLimit(text, 30);
    expect(parts.every((p) => p.length <= 30)).toBe(true);
    expect(parts.join(' ')).toBe(text);
    expect(parts[0]).toBe('Good evening, sir.');
    expect(splitForLimit('short', 200)).toEqual(['short']);
  });

  it('tells WAV from MP3 by the file header', () => {
    expect(audioMime(WAV)).toBe('audio/wav');
    expect(audioMime(MP3)).toBe('audio/mpeg');
  });

  it('sends OpenAI the style note only to models that follow it', async () => {
    const { calls, fetch } = capture();
    const model = vi.fn(() => 'gpt-4o-mini-tts');
    const tts = createOpenAiTts({
      key: () => 'sk',
      model,
      voice: () => 'onyx',
      style: () => 'calm British butler',
      fetch,
    });
    const [chunk] = await all(tts.synthesize('Hello, sir.', { voice: '', rate: '+10%', signal }));
    expect(chunk?.mime).toBe('audio/mpeg');
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(calls[0]?.init.redirect).toBe('error');
    expect(bodyOf(calls[0]?.init.body)).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'onyx',
      response_format: 'mp3',
      speed: 1.1,
      instructions: 'calm British butler',
      input: 'Hello, sir.',
    });
    model.mockReturnValue('tts-1');
    await all(tts.synthesize('Hi.', { voice: '', signal }));
    expect(bodyOf(calls[1]?.init.body).instructions).toBeUndefined();
  });

  it('keeps each Groq Orpheus request within 200 characters', async () => {
    const { calls, fetch } = capture(WAV);
    const tts = createGroqTts({ key: () => 'gsk', voice: () => 'daniel', fetch });
    const long = 'All systems are running normally, sir. '.repeat(8);
    const chunks = await all(tts.synthesize(long, { voice: '', signal }));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of calls) {
      const body = bodyOf(c.init.body) as { input: string; model: string };
      expect(body.input.length).toBeLessThanOrEqual(200);
      expect(body.model).toBe('canopylabs/orpheus-v1-english');
    }
    expect(chunks[0]?.mime).toBe('audio/wav');
  });

  it('calls Deepgram Aura with the voice as the model and the Deepgram token', async () => {
    const { calls, fetch } = capture();
    const tts = createAuraTts({ key: () => 'dg', voice: () => 'aura-2-draco-en', fetch });
    await all(tts.synthesize('Right away.', { voice: '', signal }));
    expect(calls[0]?.url).toBe('https://api.deepgram.com/v1/speak?model=aura-2-draco-en');
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('Token dg');
    expect(bodyOf(calls[0]?.init.body)).toEqual({ text: 'Right away.' });
  });

  it('throws on a missing key so the pipeline falls back to Edge', async () => {
    const { fetch } = capture();
    const tts = createAuraTts({ key: () => undefined, voice: () => 'aura-2-draco-en', fetch });
    await expect(all(tts.synthesize('x', { voice: '', signal }))).rejects.toThrow(
      'no Deepgram key',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports quota errors in plain words', async () => {
    const { fetch } = capture(MP3, 429);
    const tts = createGroqTts({ key: () => 'k', voice: () => 'troy', fetch });
    const err = (await all(tts.synthesize('x', { voice: '', signal })).catch(
      (e: unknown) => e,
    )) as {
      userMessage?: string;
    };
    expect(err.userMessage).toContain('limit is used up');
  });

  it('talks to an own server without a key, and refuses plain http outside the home network', async () => {
    const { calls, fetch } = capture(WAV);
    const url = vi.fn(() => 'http://192.168.1.20:8004/v1');
    const tts = createServerTts({
      url,
      key: () => undefined,
      model: () => 'tts-1',
      voice: () => 'jarvis-clone',
      fetch,
    });
    await all(tts.synthesize('Hello.', { voice: '', signal }));
    expect(calls[0]?.url).toBe('http://192.168.1.20:8004/v1/audio/speech');
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBeUndefined();
    url.mockReturnValue('http://203.0.113.9/v1');
    await expect(all(tts.synthesize('x', { voice: '', signal }))).rejects.toThrow(
      'speech server url refused',
    );
    expect(calls).toHaveLength(1);
  });

  it('refuses an empty answer', async () => {
    const { fetch } = capture(new Uint8Array());
    const tts = createOpenAiTts({
      key: () => 'k',
      model: () => 'tts-1',
      voice: () => 'alloy',
      style: () => '',
      fetch,
    });
    await expect(all(tts.synthesize('x', { voice: '', signal }))).rejects.toThrow('no audio');
  });
});
