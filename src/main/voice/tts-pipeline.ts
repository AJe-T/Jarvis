import type { EventPayload } from '@shared/ipc-contract';
import { errorMessage } from '../errors';
import { newId } from '../lib/util';
import type { Logger } from '../logging/logger';
import { SentenceChunker, SpokenExtractor } from './speech/speech';
import type { TtsProvider } from './types';

export interface TtsDeps {
  primary: () => TtsProvider;
  /** Tried in order when the primary voice fails (e.g. Kokoro/ElevenLabs → Edge → Windows). */
  fallbacks: () => TtsProvider[];
  voice: () => string;
  rate: () => string;
  emitAudio(p: EventPayload<'tts:audio'>): void;
  emitStop(utteranceId?: string): void;
  onFallback(err: unknown): void;
  /** The voice that just spoke a sentence (AI Router Phase 3: Sir sees every switch). */
  onEngine?(id: string, failed?: { id: string; err: unknown }): void;
  logger: Logger;
  onFirstAudio?(utteranceId: string): void;
}

interface CachedChunk {
  mime: 'audio/mpeg' | 'audio/wav';
  data: Uint8Array;
}

/** Stock lines ("Yes, sir?") as audio, so they play the moment Jarvis is woken. */
const speechCache = new Map<string, CachedChunk[]>();
const SPEECH_CACHE_MAX = 32;

function rememberSpeech(key: string, chunks: CachedChunk[]): void {
  if (chunks.length === 0) return;
  if (speechCache.size >= SPEECH_CACHE_MAX) {
    const oldest = speechCache.keys().next().value;
    if (oldest !== undefined) speechCache.delete(oldest);
  }
  speechCache.set(key, chunks);
}

/** A voice setting changed (Kokoro voice, ElevenLabs voice…): the kept lines would sound wrong. */
export function clearSpeechCache(): void {
  speechCache.clear();
}

const speechKey = (provider: string, voice: string, rate: string, sentence: string): string =>
  `${provider}|${voice}|${rate}|${sentence}`;

/**
 * Renders a stock line into the cache without playing it, so even its first use after a start
 * (or a voice change) plays at once instead of waiting seconds for an on-device voice.
 */
export async function warmSpeech(
  deps: Pick<TtsDeps, 'primary' | 'voice' | 'rate'>,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const chunker = new SentenceChunker();
  const provider = deps.primary();
  const opts = { voice: deps.voice(), rate: deps.rate(), signal };
  for (const sentence of [...chunker.push(text), ...chunker.flush()]) {
    const key = speechKey(provider.id, opts.voice, opts.rate, sentence);
    if (signal.aborted || speechCache.has(key)) continue;
    const chunks: CachedChunk[] = [];
    for await (const c of provider.synthesize(sentence, opts))
      chunks.push({ mime: c.mime, data: c.data });
    if (!signal.aborted) rememberSpeech(key, chunks);
  }
}

/**
 * One spoken reply. Text arrives as deltas (from Claude) or all at once (prompts, reminders);
 * sentences are synthesised strictly in order and sent to the renderer as they become ready.
 */
export class Utterance {
  readonly id: string;
  private readonly extractor: SpokenExtractor | null;
  private readonly chunker = new SentenceChunker();
  private readonly queue: string[] = [];
  private seq = 0;
  private ended = false;
  private pumping: Promise<void> | null = null;
  private readonly controller = new AbortController();
  private firstAudio = false;
  private markerSent = false;

  private readonly cache: boolean;

  constructor(
    private readonly deps: TtsDeps,
    opts: { id?: string; extractSpoken: boolean; cache?: boolean },
  ) {
    this.id = opts.id ?? newId('u_');
    this.extractor = opts.extractSpoken ? new SpokenExtractor() : null;
    this.cache = opts.cache ?? false;
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  push(delta: string): void {
    if (this.aborted || this.ended) return;
    const speakable = this.extractor ? this.extractor.push(delta) : delta;
    if (speakable) this.enqueue(this.chunker.push(speakable));
  }

  end(): void {
    if (this.aborted || this.ended) return;
    const tail = this.extractor ? this.extractor.end() : '';
    if (tail) this.enqueue(this.chunker.push(tail));
    this.enqueue(this.chunker.flush());
    this.ended = true;
    void this.pump();
  }

  /** Barge-in / kill switch: stop synthesis and tell the renderer to stop playback now. */
  stop(): void {
    if (this.aborted) return;
    this.controller.abort();
    this.queue.length = 0;
    this.deps.emitStop(this.id);
  }

  private enqueue(sentences: string[]): void {
    for (const s of sentences) if (/[\p{L}\p{N}]/u.test(s)) this.queue.push(s);
    void this.pump();
  }

  private pump(): Promise<void> {
    this.pumping ??= this.drain().finally(() => {
      this.pumping = null;
      if (!this.aborted && (this.queue.length > 0 || (this.ended && !this.markerSent)))
        void this.pump();
    });
    return this.pumping;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && !this.aborted) {
      const sentence = this.queue.shift() as string;
      await this.speakSentence(sentence);
    }
    if (this.ended && this.queue.length === 0 && !this.aborted && !this.markerSent) {
      // End-of-utterance marker lets the renderer report "finished" after the last chunk plays.
      this.markerSent = true;
      this.deps.emitAudio({
        utteranceId: this.id,
        seq: this.seq++,
        mime: 'audio/mpeg',
        data: new Uint8Array(0),
        last: true,
      });
    }
  }

  private async speakSentence(text: string): Promise<void> {
    const opts = {
      voice: this.deps.voice(),
      rate: this.deps.rate(),
      signal: this.controller.signal,
    };
    const chain = [...new Set([this.deps.primary(), ...this.deps.fallbacks()])];
    const key = speechKey(chain[0]?.id ?? '', opts.voice, opts.rate, text);
    const hit = this.cache ? speechCache.get(key) : undefined;
    if (hit) {
      for (const c of hit) this.send(c.mime, c.data);
      return;
    }
    let failed: { id: string; err: unknown } | undefined;
    for (const [i, provider] of chain.entries()) {
      if (this.aborted) return;
      const before = this.seq;
      const chunks: CachedChunk[] = [];
      try {
        for await (const chunk of provider.synthesize(text, opts)) {
          this.send(chunk.mime, chunk.data);
          chunks.push({ mime: chunk.mime, data: chunk.data });
        }
        // Only the chosen voice is kept: a backup voice may be gone once the first one recovers.
        if (this.cache && i === 0 && !this.aborted) rememberSpeech(key, chunks);
        if (!this.aborted) this.deps.onEngine?.(provider.id, i > 0 ? failed : undefined);
        return;
      } catch (err) {
        // Part of the sentence already played: a backup voice would repeat its start.
        if (this.aborted || this.seq !== before) return;
        this.deps.logger.warn(
          { err: errorMessage(err), provider: provider.id },
          i === chain.length - 1 ? 'last fallback TTS failed' : 'TTS failed; trying the next voice',
        );
        if (i === 0) this.deps.onFallback(err);
        failed ??= { id: provider.id, err };
      }
    }
  }

  private send(mime: 'audio/mpeg' | 'audio/wav', data: Uint8Array): void {
    if (this.aborted) return;
    if (!this.firstAudio) {
      this.firstAudio = true;
      this.deps.onFirstAudio?.(this.id);
    }
    this.deps.emitAudio({
      utteranceId: this.id,
      seq: this.seq++,
      mime,
      data: new Uint8Array(data),
    });
  }
}
