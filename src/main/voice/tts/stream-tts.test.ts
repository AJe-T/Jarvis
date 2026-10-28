import { describe, expect, it } from 'vitest';
import type { TtsChunk, TtsProvider } from '../types';
import {
  createAuraStreamTts,
  createElevenLabsStreamTts,
  streamFirst,
  STREAM_RATE,
  type StreamSocket,
} from './stream-tts';

/** A WebSocket stand-in: opens on the next tick and lets the test answer what it was sent. */
class FakeSocket implements StreamSocket {
  binaryType = 'blob';
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  private handlers = new Map<string, Array<(e: { data: unknown }) => void>>();
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
    reply: (sock: FakeSocket, msg: Record<string, unknown>) => void,
  ) {
    this.reply = reply;
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open');
    }, 0);
  }
  private reply: (sock: FakeSocket, msg: Record<string, unknown>) => void;
  addEventListener(type: string, cb: (e: { data: unknown }) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb]);
  }
  emit(type: string, data?: unknown): void {
    for (const h of this.handlers.get(type) ?? []) h({ data });
  }
  send(data: string): void {
    const msg = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(msg);
    setTimeout(() => this.reply(this, msg), 0);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
}

const pcm = (...samples: number[]): ArrayBuffer => Int16Array.from(samples).buffer;
const opts = (signal = new AbortController().signal) => ({ voice: '', rate: '+0%', signal });

async function all(p: TtsProvider, text: string, signal?: AbortSignal): Promise<TtsChunk[]> {
  const out: TtsChunk[] = [];
  for await (const c of p.synthesize(text, opts(signal))) out.push(c);
  return out;
}

const samples = (chunks: TtsChunk[]): number[] =>
  chunks.flatMap((c) => [...new Int16Array(c.data.slice().buffer)]);

describe('Deepgram Aura streaming (voice fix 2B)', () => {
  function aura(reply: (sock: FakeSocket, msg: Record<string, unknown>) => void) {
    const sockets: FakeSocket[] = [];
    const p = createAuraStreamTts({
      key: () => 'dg-key',
      voice: () => 'aura-2-draco-en',
      open: (url, headers) => {
        const s = new FakeSocket(url, headers, reply);
        sockets.push(s);
        return s;
      },
    });
    return { p, sockets };
  }

  it('streams PCM for each sentence over one kept-open connection, key in the header', async () => {
    const t = aura((sock, msg) => {
      if (msg['type'] !== 'Flush') return;
      sock.emit('message', pcm(1, 2));
      // A frame that ends mid-sample: the odd byte is carried to the next one.
      sock.emit('message', new Uint8Array([3, 0, 4]).buffer);
      sock.emit('message', new Uint8Array([0]).buffer);
      sock.emit('message', JSON.stringify({ type: 'Flushed', sequence_id: 0 }));
    });
    const first = await all(t.p, 'Good evening, sir.');
    expect(first.every((c) => c.mime === 'audio/pcm' && c.sampleRate === STREAM_RATE)).toBe(true);
    expect(samples(first)).toEqual([1, 2, 3, 4]);
    await all(t.p, 'All systems are ready.');
    expect(t.sockets).toHaveLength(1);
    const s = t.sockets[0] as FakeSocket;
    expect(s.url).toContain('wss://api.deepgram.com/v1/speak?model=aura-2-draco-en');
    expect(s.url).toContain('encoding=linear16&sample_rate=24000');
    expect(s.url).not.toContain('dg-key');
    expect(s.headers).toEqual({ authorization: 'Token dg-key' });
    expect(s.sent.map((m) => m['type'])).toEqual(['Speak', 'Flush', 'Speak', 'Flush']);
  });

  it('a Warning before any audio (too many flushes) fails the sentence so another voice speaks', async () => {
    const t = aura((sock, msg) => {
      if (msg['type'] === 'Flush')
        sock.emit('message', JSON.stringify({ type: 'Warning', description: 'flush limit' }));
    });
    await expect(all(t.p, 'Hello.')).rejects.toThrow(/flush limit/);
  });

  it('a dropped connection fails the sentence and the next one reconnects', async () => {
    let n = 0;
    const t = aura((sock, msg) => {
      if (msg['type'] !== 'Flush') return;
      if (n++ === 0) sock.close();
      else sock.emit('message', JSON.stringify({ type: 'Flushed' }));
    });
    await expect(all(t.p, 'One.')).rejects.toThrow(/closed/);
    await all(t.p, 'Two.');
    expect(t.sockets).toHaveLength(2);
  });
});

describe('ElevenLabs streaming (voice fix 2B)', () => {
  it('sends the init, the sentence and end-of-input, streams base64 PCM, and warms the next socket', async () => {
    const sockets: FakeSocket[] = [];
    const p = createElevenLabsStreamTts({
      key: () => 'xi-key',
      voiceId: () => 'onwK4e9ZLuTAKqWW03F9',
      model: () => 'eleven_flash_v2_5',
      open: (url, headers) => {
        const s = new FakeSocket(url, headers, (sock, msg) => {
          if (msg['text'] !== '') return;
          sock.emit(
            'message',
            JSON.stringify({ audio: Buffer.from(pcm(5, 6)).toString('base64') }),
          );
          sock.emit('message', JSON.stringify({ audio: null, isFinal: true }));
        });
        sockets.push(s);
        return s;
      },
    });
    const chunks = await all(p, 'Right away, sir.');
    expect(samples(chunks)).toEqual([5, 6]);
    const s = sockets[0] as FakeSocket;
    expect(s.url).toContain(
      '/v1/text-to-speech/onwK4e9ZLuTAKqWW03F9/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000',
    );
    expect(s.headers).toEqual({ 'xi-api-key': 'xi-key' });
    expect(s.sent).toEqual([
      { text: ' ', voice_settings: { speed: 1 } },
      { text: 'Right away, sir. ', try_trigger_generation: true },
      { text: '' },
    ]);
    expect(sockets).toHaveLength(2); // the next sentence's connection is already opening
    await all(p, 'Done.');
    expect(sockets).toHaveLength(3); // the warm one was used, a new one warmed
    expect((sockets[1] as FakeSocket).sent.at(1)).toEqual({
      text: 'Done. ',
      try_trigger_generation: true,
    });
  });
});

describe('streaming first, HTTP if it fails before any audio', () => {
  const voice = (id: string, chunks: number, fail: boolean): TtsProvider => ({
    id: 'aura',
    async *synthesize() {
      for (let i = 0; i < chunks; i++)
        yield { mime: 'audio/pcm', data: new Uint8Array(2), sampleRate: STREAM_RATE };
      if (fail) throw new Error(`${id} failed`);
    },
  });

  it('uses HTTP when the socket fails at once', async () => {
    const out = await all(streamFirst(voice('ws', 0, true), voice('http', 3, false)), 'Hi.');
    expect(out).toHaveLength(3);
  });

  it('does not repeat the sentence over HTTP once part of it was heard', async () => {
    await expect(
      all(streamFirst(voice('ws', 1, true), voice('http', 3, false)), 'Hi.'),
    ).rejects.toThrow('ws failed');
  });
});
