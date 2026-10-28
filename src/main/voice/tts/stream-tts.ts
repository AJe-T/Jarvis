import { ELEVEN_VOICE_RE, type ElevenModel } from '@shared/voices';
import { JarvisError } from '../../errors';
import type { TtsChunk, TtsProvider } from '../types';
import { splitForLimit } from './cloud-tts';
import { speedFromRate } from './kokoro';

/**
 * Voice fix 2B: streaming voices over a WebSocket, raw 16-bit PCM out. The sentence chunker still
 * feeds them text a sentence at a time, but audio arrives (and plays) while the sentence is still
 * being generated, and PCM has none of the MP3 padding that clicked between sentences.
 * APIs checked 2026-10-29: developers.deepgram.com/reference/text-to-speech/speak-streaming and
 * elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.
 */

/** Both voices are asked for 24 kHz mono 16-bit PCM. */
export const STREAM_RATE = 24_000;
/** No audio this long after sending a sentence: the voice is stuck (the pipeline tries the next). */
const FIRST_AUDIO_MS = 8000;
/** A gap this long inside a sentence's audio. */
const GAP_MS = 5000;
/** A warm Deepgram socket nobody used for this long is closed. */
const IDLE_CLOSE_MS = 60_000;
const OPEN = 1;

/** What these voices need of a WebSocket: Node's built-in one in the app, a fake in tests. */
export interface StreamSocket {
  binaryType: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: 'open' | 'close' | 'error', cb: () => void): void;
  addEventListener(type: 'message', cb: (e: { data: unknown }) => void): void;
}
export type OpenSocket = (url: string, headers: Record<string, string>) => StreamSocket;

/** Node 24's WebSocket (undici) takes request headers, so keys never go in the URL. */
export const nodeSocket: OpenSocket = (url, headers) => new WebSocket(url, { headers });

type Event = { audio: Uint8Array } | { done: true } | { fail: Error } | { json: unknown };

/** Socket events as a queue a generator can wait on, with timeouts. */
function inbox(signal: AbortSignal) {
  const queue: Event[] = [];
  let wake: (() => void) | null = null;
  const push = (e: Event): void => {
    queue.push(e);
    wake?.();
  };
  signal.addEventListener('abort', () => wake?.(), { once: true });
  async function next(timeoutMs: number): Promise<Event> {
    while (queue.length === 0) {
      if (signal.aborted) return { done: true };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await new Promise<boolean>((resolve) => {
        wake = () => resolve(false);
        timer = setTimeout(() => resolve(true), timeoutMs);
      });
      clearTimeout(timer);
      wake = null;
      if (timedOut) return { fail: new Error('the voice stopped sending audio') };
    }
    return queue.shift() as Event;
  }
  return { push, next };
}

/** Binary frames → whole 16-bit samples (a frame may end mid-sample). */
function pcmJoiner() {
  let odd: number | null = null;
  return (bytes: Uint8Array): Uint8Array => {
    const all = odd === null ? bytes : Uint8Array.of(odd, ...bytes);
    odd = all.length % 2 ? (all[all.length - 1] ?? 0) : null;
    return all.subarray(0, all.length - (all.length % 2));
  };
}

const asBytes = (data: unknown): Uint8Array | null =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : null;

function waitOpen(sock: StreamSocket, timeoutMs: number): Promise<void> {
  if (sock.readyState === OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the voice did not connect')), timeoutMs);
    sock.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    const fail = (): void => {
      clearTimeout(timer);
      reject(new Error('the voice connection failed'));
    };
    sock.addEventListener('error', fail);
    sock.addEventListener('close', fail);
  });
}

/** Runs one sentence at a time through a shared connection. */
function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return async (): Promise<() => void> => {
    let release: () => void = () => undefined;
    const mine = new Promise<void>((r) => (release = r));
    const before = tail;
    tail = before.then(() => mine);
    await before;
    return release;
  };
}

const needKey = (key: string | undefined, who: string): string => {
  if (!key)
    throw new JarvisError('INVALID', `no ${who} key`, `Add a ${who} API key in Settings → Voice.`);
  return key;
};

/**
 * Deepgram Aura-2 over its speak WebSocket. One connection is kept open (per voice and speed) and
 * each sentence is Speak + Flush; its audio streams back until Flushed.
 */
export function createAuraStreamTts(o: {
  key: () => string | undefined;
  voice: () => string;
  open?: OpenSocket;
}): TtsProvider {
  const open = o.open ?? nodeSocket;
  const turn = serial();
  let conn: {
    sock: StreamSocket;
    id: string;
    ready: Promise<void>;
    route: ((e: Event) => void) | null;
    idle?: ReturnType<typeof setTimeout>;
  } | null = null;

  function connect(key: string, voice: string, speed: number) {
    const id = `${voice}|${speed}`;
    if (conn && conn.id === id && conn.sock.readyState <= OPEN) return conn;
    conn?.sock.close();
    const url = `wss://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=linear16&sample_rate=${STREAM_RATE}&speed=${speed}`;
    const sock = open(url, { authorization: `Token ${key}` });
    sock.binaryType = 'arraybuffer';
    const c: NonNullable<typeof conn> = { sock, id, ready: waitOpen(sock, 5000), route: null };
    c.ready.catch(() => undefined);
    sock.addEventListener('message', (e) => {
      const bytes = asBytes(e.data);
      if (bytes) return c.route?.({ audio: bytes });
      try {
        c.route?.({ json: JSON.parse(String(e.data)) });
      } catch {
        // not JSON: ignore
      }
    });
    const gone = (): void => {
      if (conn === c) conn = null;
      c.route?.({ fail: new Error('Deepgram closed the voice connection') });
    };
    sock.addEventListener('close', gone);
    sock.addEventListener('error', gone);
    conn = c;
    return c;
  }

  return {
    id: 'aura',
    async *synthesize(text, { rate, signal }) {
      const key = needKey(o.key(), 'Deepgram');
      const release = await turn();
      try {
        for (const part of splitForLimit(text, 2000)) {
          if (signal.aborted) return;
          const c = connect(key, o.voice(), Math.min(1.5, speedFromRate(rate)));
          clearTimeout(c.idle);
          await c.ready;
          const box = inbox(signal);
          c.route = box.push;
          const join = pcmJoiner();
          c.sock.send(JSON.stringify({ type: 'Speak', text: part }));
          c.sock.send(JSON.stringify({ type: 'Flush' }));
          let heard = false;
          for (;;) {
            const e = await box.next(heard ? GAP_MS : FIRST_AUDIO_MS);
            if (signal.aborted) {
              // Audio for this sentence may still be on its way: a fresh connection next time.
              c.sock.close();
              return;
            }
            if ('fail' in e) {
              c.sock.close();
              throw e.fail;
            }
            if ('done' in e) return;
            if ('json' in e) {
              const m = e.json as { type?: string; description?: string };
              if (m.type === 'Flushed') break;
              // A Warning (e.g. too many flushes a minute) with no audio: let the next voice speak.
              if (m.type === 'Warning' && !heard) {
                c.sock.close();
                throw new Error(`Deepgram: ${m.description ?? 'warning'}`);
              }
              continue;
            }
            const data = join(e.audio);
            if (data.length === 0) continue;
            heard = true;
            yield { mime: 'audio/pcm', data, sampleRate: STREAM_RATE } satisfies TtsChunk;
          }
          c.route = null;
          c.idle = setTimeout(() => c.sock.close(), IDLE_CLOSE_MS);
        }
      } finally {
        release();
      }
    },
  };
}

/**
 * ElevenLabs over its stream-input WebSocket. Each sentence uses its own connection (the API has no
 * per-sentence "done" short of closing), but the next one is opened and initialised while the
 * current sentence plays, so it is ready by the time the next sentence comes.
 */
export function createElevenLabsStreamTts(o: {
  key: () => string | undefined;
  voiceId: () => string;
  model: () => ElevenModel;
  open?: OpenSocket;
}): TtsProvider {
  const open = o.open ?? nodeSocket;
  let warm: {
    id: string;
    sock: StreamSocket;
    box: ReturnType<typeof inbox> | null;
    ready: Promise<void>;
    events: Event[];
  } | null = null;

  function start(key: string, voice: string, model: string, speed: number) {
    const id = `${voice}|${model}|${speed}`;
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream-input?model_id=${encodeURIComponent(model)}&output_format=pcm_${STREAM_RATE}&inactivity_timeout=60`;
    const sock = open(url, { 'xi-api-key': key });
    const w: NonNullable<typeof warm> = {
      id,
      sock,
      box: null,
      events: [],
      ready: Promise.resolve(),
    };
    const route = (e: Event): void => (w.box ? w.box.push(e) : void w.events.push(e));
    sock.addEventListener('message', (e) => {
      try {
        const m = JSON.parse(String(e.data)) as {
          audio?: string | null;
          isFinal?: boolean;
          error?: string;
          message?: string;
        };
        if (m.audio) route({ audio: new Uint8Array(Buffer.from(m.audio, 'base64')) });
        if (m.isFinal) route({ done: true });
        if (m.error || (m.message && !m.audio))
          route({ fail: new Error(`ElevenLabs: ${m.error ?? m.message}`) });
      } catch {
        // not JSON: ignore
      }
    });
    sock.addEventListener('close', () => route({ done: true }));
    sock.addEventListener('error', () =>
      route({ fail: new Error('ElevenLabs voice connection failed') }),
    );
    w.ready = waitOpen(sock, 5000).then(() =>
      sock.send(JSON.stringify({ text: ' ', voice_settings: { speed: Math.min(1.2, speed) } })),
    );
    w.ready.catch(() => undefined);
    return w;
  }

  return {
    id: 'elevenlabs',
    async *synthesize(text, { rate, signal }) {
      const key = needKey(o.key(), 'ElevenLabs');
      const voice = o.voiceId();
      if (!ELEVEN_VOICE_RE.test(voice))
        throw new JarvisError('INVALID', 'bad voice id', 'That ElevenLabs voice id looks wrong.');
      const model = o.model();
      const speed = speedFromRate(rate);
      const id = `${voice}|${model}|${speed}`;
      const w =
        warm && warm.id === id && warm.sock.readyState <= OPEN
          ? warm
          : start(key, voice, model, speed);
      if (w !== warm) warm?.sock.close();
      warm = null;
      await w.ready;
      const box = inbox(signal);
      for (const e of w.events.splice(0)) box.push(e);
      w.box = box;
      w.sock.send(JSON.stringify({ text: `${text.trim()} `, try_trigger_generation: true }));
      w.sock.send(JSON.stringify({ text: '' })); // end of input: generate the rest, then close
      // Ready the next sentence's connection while this one plays.
      warm = start(key, voice, model, speed);
      const join = pcmJoiner();
      let heard = false;
      try {
        for (;;) {
          const e = await box.next(heard ? GAP_MS : FIRST_AUDIO_MS);
          if (signal.aborted || 'done' in e) return;
          if ('fail' in e) throw e.fail;
          if (!('audio' in e)) continue;
          const data = join(e.audio);
          if (data.length === 0) continue;
          heard = true;
          yield { mime: 'audio/pcm', data, sampleRate: STREAM_RATE } satisfies TtsChunk;
        }
      } finally {
        w.sock.close();
      }
    },
  };
}

/**
 * The streaming voice first; if it fails before any audio (a firewall blocking WebSockets, a model
 * the socket doesn't support), the same voice over plain HTTP. Then the pipeline's own fallbacks.
 */
export function streamFirst(stream: TtsProvider, http: TtsProvider): TtsProvider {
  return {
    id: stream.id,
    async *synthesize(text, opts) {
      let any = false;
      try {
        for await (const c of stream.synthesize(text, opts)) {
          any = true;
          yield c;
        }
        return;
      } catch (err) {
        if (any || opts.signal.aborted) throw err;
      }
      yield* http.synthesize(text, opts);
    },
  };
}
