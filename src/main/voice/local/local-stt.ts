import type { SttProvider, SttSession } from '../types';
import { VAD_WINDOW, type Vad } from './onnx';
import type { Transcriber } from './whisper';

export const WINDOW_MS = (VAD_WINDOW / 16000) * 1000; // 32 ms
export const START_PROB = 0.5;
export const END_PROB = 0.35;
export const END_SILENCE_MS = 700;
export const PRE_ROLL_WINDOWS = 10; // ~320 ms before speech was detected, so first syllables aren't cut
const MAX_SPEECH_MS = 30_000;

/** int16 mic samples → [-1, 1] floats, carrying a partial window over to the next call. */
export function toWindows(
  pending: Float32Array,
  frame: Int16Array,
): { windows: Float32Array[]; rest: Float32Array } {
  const joined = new Float32Array(pending.length + frame.length);
  joined.set(pending);
  for (let i = 0; i < frame.length; i++) joined[pending.length + i] = (frame[i] ?? 0) / 32768;
  const windows: Float32Array[] = [];
  let at = 0;
  for (; at + VAD_WINDOW <= joined.length; at += VAD_WINDOW)
    windows.push(joined.slice(at, at + VAD_WINDOW));
  return { windows, rest: joined.slice(at) };
}

type Handler = (...args: never[]) => void;

/**
 * Whisper isn't streaming, so the session listens with Silero VAD and transcribes once Sir stops
 * talking: speechStarted → (≥700 ms quiet) → final + utteranceEnd. One utterance per session, as the
 * voice controller closes the session after the final transcript.
 */
export function createWhisperStt(deps: {
  vad(): Promise<Vad>;
  transcriber(): Promise<Transcriber>;
}): SttProvider {
  return {
    id: 'whisper',
    async start({ signal, language }) {
      // Load (or reuse) both models up front so the first words aren't lost while they load.
      const [vad, transcriber] = await Promise.all([deps.vad(), deps.transcriber()]);
      vad.reset();
      const handlers = new Map<string, Handler[]>();
      const fire = (event: string, ...args: unknown[]): void => {
        for (const h of handlers.get(event) ?? []) (h as (...a: unknown[]) => void)(...args);
      };
      let pending: Float32Array = new Float32Array(0);
      const preRoll: Float32Array[] = [];
      const speech: Float32Array[] = [];
      let inSpeech = false;
      let quietMs = 0;
      let done = false;
      let chain = Promise.resolve();

      async function finish(): Promise<void> {
        done = true;
        const audio = new Float32Array(speech.reduce((a, w) => a + w.length, 0));
        let at = 0;
        for (const w of speech) {
          audio.set(w, at);
          at += w.length;
        }
        const text = await transcriber.transcribe(audio, language);
        if (signal.aborted) return;
        if (text) fire('final', text);
        fire('utteranceEnd');
      }

      async function step(window: Float32Array): Promise<void> {
        if (done || signal.aborted) return;
        const p = await vad.prob(window);
        if (!inSpeech) {
          preRoll.push(window);
          if (preRoll.length > PRE_ROLL_WINDOWS) preRoll.shift();
          if (p < START_PROB) return;
          inSpeech = true;
          speech.push(...preRoll);
          fire('speechStarted');
          return;
        }
        speech.push(window);
        quietMs = p < END_PROB ? quietMs + WINDOW_MS : 0;
        if (quietMs >= END_SILENCE_MS || speech.length * WINDOW_MS >= MAX_SPEECH_MS) await finish();
      }

      const session: SttSession = {
        write(frame) {
          if (done) return;
          const { windows, rest } = toWindows(pending, frame);
          for (const w of windows) {
            chain = chain
              .then(() => step(w))
              .catch((err: unknown) => {
                done = true;
                fire('error', err instanceof Error ? err : new Error(String(err)));
              });
          }
          pending = rest;
        },
        on: (event: string, cb: Handler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), cb]);
        },
        async close() {
          done = true;
        },
      };
      return session;
    },
  };
}
