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
  mime: 'audio/mpeg' | 'audio/wav';
  data: Uint8Array;
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
  /** Porcupine answers synchronously; openWakeWord (ONNX) asynchronously. */
  process(frame: Int16Array): boolean | Promise<boolean>;
  release(): void;
}

export function rms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length) / 32768;
}
