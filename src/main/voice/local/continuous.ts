import type { Vad } from './onnx';
import {
  END_PROB,
  END_SILENCE_MS,
  PRE_ROLL_WINDOWS,
  START_PROB,
  WINDOW_MS,
  toWindows,
} from './local-stt';
import type { Transcriber } from './whisper';

/** Ambient listening cuts long speech here so a mention of Jarvis isn't held back for long. */
const MAX_UTTERANCE_MS = 12_000;
/** Utterances waiting for Whisper; past this, the oldest is dropped (Whisper can't keep up). */
const MAX_BACKLOG = 3;

export interface HeardSegment {
  text: string;
  start: number;
  end: number;
}

export interface ContinuousTranscriber {
  write(frame: Int16Array): void;
  /** Forget audio in progress (e.g. when another listener takes the microphone). */
  reset(): void;
  close(): void;
}

/**
 * ADR-012 "always listening" (on-device only): every stretch of speech the VAD finds is transcribed
 * and handed to onSegment; nothing is stored or sent anywhere by this module.
 */
export function createContinuousTranscriber(deps: {
  vad: Vad;
  transcriber: Transcriber;
  language?(): string;
  /** Pause that ends a phrase (Settings → Voice); defaults to END_SILENCE_MS. */
  endSilenceMs?(): number;
  onSpeechStart?(): void;
  onSegment(seg: HeardSegment): void;
  onBacklog?(dropped: number): void;
  onError(err: Error): void;
  now?(): number;
}): ContinuousTranscriber {
  const now = deps.now ?? Date.now;
  let pending: Float32Array = new Float32Array(0);
  let preRoll: Float32Array[] = [];
  let speech: Float32Array[] = [];
  let inSpeech = false;
  let quietMs = 0;
  let startedAt = 0;
  let closed = false;
  let vadChain = Promise.resolve();
  const backlog: Array<{ audio: Float32Array; start: number; end: number }> = [];
  let transcribing = false;
  let dropped = 0;

  async function drain(): Promise<void> {
    if (transcribing) return;
    transcribing = true;
    try {
      while (backlog.length && !closed) {
        const job = backlog.shift();
        if (!job) break;
        const text = await deps.transcriber.transcribe(job.audio, deps.language?.());
        if (text && !closed) deps.onSegment({ text, start: job.start, end: job.end });
      }
    } catch (err) {
      deps.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      transcribing = false;
    }
  }

  function cut(): void {
    const audio = new Float32Array(speech.reduce((a, w) => a + w.length, 0));
    let at = 0;
    for (const w of speech) {
      audio.set(w, at);
      at += w.length;
    }
    backlog.push({ audio, start: startedAt, end: now() });
    if (backlog.length > MAX_BACKLOG) {
      backlog.shift();
      dropped++;
      deps.onBacklog?.(dropped);
    }
    speech = [];
    inSpeech = false;
    quietMs = 0;
    void drain();
  }

  async function step(window: Float32Array): Promise<void> {
    if (closed) return;
    const p = await deps.vad.prob(window);
    if (!inSpeech) {
      preRoll.push(window);
      if (preRoll.length > PRE_ROLL_WINDOWS) preRoll.shift();
      if (p < START_PROB) return;
      inSpeech = true;
      startedAt = now() - preRoll.length * WINDOW_MS;
      speech = [...preRoll];
      preRoll = [];
      deps.onSpeechStart?.();
      return;
    }
    speech.push(window);
    quietMs = p < END_PROB ? quietMs + WINDOW_MS : 0;
    if (
      quietMs >= (deps.endSilenceMs?.() ?? END_SILENCE_MS) ||
      speech.length * WINDOW_MS >= MAX_UTTERANCE_MS
    )
      cut();
  }

  return {
    write(frame) {
      if (closed) return;
      const { windows, rest } = toWindows(pending, frame);
      pending = rest;
      for (const w of windows)
        vadChain = vadChain
          .then(() => step(w))
          .catch((err: unknown) =>
            deps.onError(err instanceof Error ? err : new Error(String(err))),
          );
    },
    reset() {
      speech = [];
      preRoll = [];
      inSpeech = false;
      quietMs = 0;
      pending = new Float32Array(0);
      deps.vad.reset();
    },
    close() {
      closed = true;
      backlog.length = 0;
    },
  };
}
