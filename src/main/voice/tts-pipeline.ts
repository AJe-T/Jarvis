import type { EventPayload } from '@shared/ipc-contract';
import { errorMessage } from '../errors';
import { newId } from '../lib/util';
import type { Logger } from '../logging/logger';
import { SentenceChunker, SpokenExtractor } from './speech/speech';
import type { TtsProvider } from './types';

export interface TtsDeps {
  primary: () => TtsProvider;
  fallback: TtsProvider;
  voice: () => string;
  rate: () => string;
  emitAudio(p: EventPayload<'tts:audio'>): void;
  emitStop(utteranceId?: string): void;
  onFallback(): void;
  logger: Logger;
  onFirstAudio?(utteranceId: string): void;
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

  constructor(
    private readonly deps: TtsDeps,
    opts: { id?: string; extractSpoken: boolean },
  ) {
    this.id = opts.id ?? newId('u_');
    this.extractor = opts.extractSpoken ? new SpokenExtractor() : null;
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
    try {
      for await (const chunk of this.deps.primary().synthesize(text, opts))
        this.send(chunk.mime, chunk.data);
    } catch (err) {
      if (this.aborted) return;
      this.deps.logger.warn(
        { err: errorMessage(err), provider: this.deps.primary().id },
        'TTS failed; using Windows voice',
      );
      this.deps.onFallback();
      try {
        for await (const chunk of this.deps.fallback.synthesize(text, opts))
          this.send(chunk.mime, chunk.data);
      } catch (err2) {
        this.deps.logger.warn({ err: errorMessage(err2) }, 'fallback TTS failed');
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
