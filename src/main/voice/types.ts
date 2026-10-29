// API-Guide.md §9 voice interfaces.
import type { TtsEngineId } from '@shared/speech-engines';

export interface SttSession {
  write(frame: Int16Array): void;
  on(event: 'partial' | 'final', cb: (text: string) => void): void;
  on(event: 'utteranceEnd' | 'speechStarted', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  close(): Promise<void>;
}

export interface SttProvider {
  readonly id: string;
  start(opts: {
    sampleRate: 16000;
    language: string;
    signal: AbortSignal;
    /** Pause that ends an utterance (dictation allows longer pauses). */
    endSilenceMs?: number;
    /** Keep listening after an utterance ends (dictation, composing a message). */
    continuous?: boolean;
    /** Show words while Sir is still speaking (on-device Whisper re-reads the phrase so far). */
    livePartials?: boolean;
  }): Promise<SttSession>;
}

export interface TtsChunk {
  /** audio/pcm (voice fix 2B): raw 16-bit little-endian mono samples at `sampleRate`. */
  mime: 'audio/mpeg' | 'audio/wav' | 'audio/pcm';
  data: Uint8Array;
  sampleRate?: number;
}

export interface TtsProvider {
  readonly id: TtsEngineId | 'fake';
  synthesize(
    text: string,
    opts: { voice: string; rate?: string; signal: AbortSignal },
  ): AsyncIterable<TtsChunk>;
}

export interface Recorder {
  readonly frameLength: number;
  start(): void;
  stop(): void;
  read(): Promise<Int16Array>;
  release(): void;
  readonly isRecording: boolean;
}

export interface WakeWord {
  readonly frameLength: number;
  /**
   * Porcupine and the in-process spotter answer synchronously; engines in the audio worker (and
   * openWakeWord in tests) asynchronously. May be called again before the last answer came back.
   */
  process(frame: Int16Array): boolean | Promise<boolean>;
  /**
   * Forget the audio heard so far. Called when listening ends: the engine was not fed while Sir
   * spoke, so its buffers still hold the phrase that woke Jarvis and would fire again.
   */
  reset(): void;
  release(): void;
}

export function rms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length) / 32768;
}
