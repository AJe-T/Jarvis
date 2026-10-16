import { isAllowedSpeechServer, speechServerUrl } from '@shared/speech-engines';
import { JarvisError } from '../../errors';
import { readCapped } from '../http-body';
import type { TtsChunk, TtsProvider } from '../types';
import { speedFromRate } from './kokoro';

/**
 * ADR-038 cloud and self-hosted voices: OpenAI, Groq (Orpheus), Deepgram Aura-2 and any server
 * that speaks OpenAI's /audio/speech. One request per sentence (the TTS pipeline splits replies);
 * a failure throws and the pipeline falls back to Edge, then the Windows voice. API shapes
 * verified 2026-10-15 (API-Guide.md §9.3).
 */

type Fetch = typeof fetch;
const TIMEOUT_MS = 30_000;
/** A sentence of speech is well under this; anything bigger is refused, not buffered. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/** Splits text into pieces of at most `limit` characters, at sentence marks or spaces if it can. */
export function splitForLimit(text: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    // Prefer a sentence or clause mark, then a space, then a hard cut.
    const mark = Math.max(...['. ', '! ', '? ', '; ', ', '].map((m) => window.lastIndexOf(m) + 1));
    const space = window.lastIndexOf(' ');
    let at = limit;
    if (mark > limit / 3) at = mark;
    else if (space > limit / 3) at = space;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** WAV files start with RIFF; anything else here is MP3 (Chromium decodes either). */
export function audioMime(data: Uint8Array): TtsChunk['mime'] {
  return data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    ? 'audio/wav'
    : 'audio/mpeg';
}

function needKey(key: string | undefined, who: string): string {
  if (!key)
    throw new JarvisError('INVALID', `no ${who} key`, `Add your ${who} key in Settings → Voice.`);
  return key;
}

/** Status only: error bodies can echo what was sent. */
export function httpError(who: string, status: number, what = 'speak'): JarvisError {
  const user =
    status === 401 || status === 403
      ? `${who} rejected the key. Check it in Settings → Voice.`
      : status === 429
        ? `${who}'s limit is used up for now; ${what === 'speak' ? 'Jarvis is using another voice' : 'try again shortly or choose another engine'}.`
        : `${who} couldn't ${what} (HTTP ${status}).`;
  return new JarvisError('TOOL_FAILED', `${who}: HTTP ${status}`, user);
}

async function postForAudio(
  doFetch: Fetch,
  who: string,
  url: string,
  init: { headers: Record<string, string>; body: string },
  signal: AbortSignal,
): Promise<Uint8Array> {
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
  });
  if (!res.ok) throw httpError(who, res.status);
  const data = await readCapped(res, MAX_AUDIO_BYTES, who);
  if (data.byteLength === 0) throw new Error(`${who} returned no audio`);
  return data;
}

interface OpenAiSpeechDeps {
  id: 'openai' | 'groq' | 'server';
  who: string;
  url: () => string;
  key: () => string | undefined;
  /** Self-hosted servers often need no key. */
  keyOptional?: boolean;
  /** Request body without `input`. */
  body: (rate: string | undefined) => Record<string, unknown>;
  /** Longest `input` the service accepts. */
  maxChars: number;
  fetch?: Fetch;
}

/** OpenAI's /audio/speech, as served by OpenAI, Groq and self-hosted servers. */
export function createOpenAiSpeechTts(d: OpenAiSpeechDeps): TtsProvider {
  return {
    id: d.id,
    async *synthesize(text, { rate, signal }) {
      const key = d.keyOptional ? d.key() : needKey(d.key(), d.who);
      const url = d.url();
      if (d.id === 'server' && !isAllowedSpeechServer(url))
        throw new JarvisError(
          'INVALID',
          'speech server url refused',
          'The voice server address must be https://, or http:// to this PC or your home network.',
        );
      for (const input of splitForLimit(text, d.maxChars)) {
        if (signal.aborted) return;
        const data = await postForAudio(
          d.fetch ?? fetch,
          d.who,
          url,
          {
            headers: key ? { authorization: `Bearer ${key}` } : {},
            body: JSON.stringify({ ...d.body(rate), input }),
          },
          signal,
        );
        if (signal.aborted) return;
        yield { mime: audioMime(data), data } satisfies TtsChunk;
      }
    },
  };
}

export function createOpenAiTts(o: {
  key: () => string | undefined;
  model: () => string;
  voice: () => string;
  style: () => string;
  fetch?: Fetch;
}): TtsProvider {
  return createOpenAiSpeechTts({
    id: 'openai',
    who: 'OpenAI',
    url: () => 'https://api.openai.com/v1/audio/speech',
    key: o.key,
    maxChars: 4096,
    body: (rate) => {
      const model = o.model();
      const style = o.style().trim();
      return {
        model,
        voice: o.voice(),
        response_format: 'mp3',
        speed: speedFromRate(rate),
        // The tts-1 models don't take instructions.
        ...(style && model.startsWith('gpt-') ? { instructions: style } : {}),
      };
    },
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
}

export function createGroqTts(o: {
  key: () => string | undefined;
  voice: () => string;
  fetch?: Fetch;
}): TtsProvider {
  return createOpenAiSpeechTts({
    id: 'groq',
    who: 'Groq',
    url: () => 'https://api.groq.com/openai/v1/audio/speech',
    key: o.key,
    // Orpheus takes at most 200 characters per request and only returns WAV.
    maxChars: 200,
    body: () => ({
      model: 'canopylabs/orpheus-v1-english',
      voice: o.voice(),
      response_format: 'wav',
    }),
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
}

export function createServerTts(o: {
  url: () => string;
  key: () => string | undefined;
  model: () => string;
  voice: () => string;
  fetch?: Fetch;
}): TtsProvider {
  return createOpenAiSpeechTts({
    id: 'server',
    who: 'The voice server',
    url: () => speechServerUrl(o.url(), 'audio/speech'),
    key: o.key,
    keyOptional: true,
    maxChars: 4096,
    body: (rate) => ({
      model: o.model(),
      voice: o.voice(),
      response_format: 'wav',
      speed: speedFromRate(rate),
    }),
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
}

/** Deepgram Aura-2: POST /v1/speak?model=… with {text}; returns MP3. Same key as Deepgram STT. */
export function createAuraTts(o: {
  key: () => string | undefined;
  voice: () => string;
  fetch?: Fetch;
}): TtsProvider {
  return {
    id: 'aura',
    async *synthesize(text, { signal }) {
      const key = needKey(o.key(), 'Deepgram');
      const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(o.voice())}`;
      for (const part of splitForLimit(text, 2000)) {
        if (signal.aborted) return;
        const data = await postForAudio(
          o.fetch ?? fetch,
          'Deepgram',
          url,
          { headers: { authorization: `Token ${key}` }, body: JSON.stringify({ text: part }) },
          signal,
        );
        if (signal.aborted) return;
        yield { mime: audioMime(data), data } satisfies TtsChunk;
      }
    },
  };
}
