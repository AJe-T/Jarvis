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

/** Gap between live re-reads of the phrase so far (each waits for the previous one to finish). */
export const PARTIAL_EVERY_MS = 700;

function joinWindows(windows: Float32Array[]): Float32Array {
  const audio = new Float32Array(windows.reduce((a, w) => a + w.length, 0));
  let at = 0;
  for (const w of windows) {
    audio.set(w, at);
    at += w.length;
  }
  return audio;
}

/**
 * Whisper isn't streaming, so the session listens with Silero VAD and transcribes once Sir stops
 * talking: speechStarted → (≥700 ms quiet) → final + utteranceEnd. By default one utterance per
 * session, as the voice controller closes the session after the final transcript. `continuous` keeps
 * going for dictation; `livePartials` re-reads the phrase so far while Sir speaks, so words appear as
 * he says them (like a phone keyboard). Whisper runs one job at a time: a live re-read is skipped while
 * another is running, and the final waits for it.
 */
export function createWhisperStt(deps: {
  vad(): Promise<Vad>;
  transcriber(): Promise<Transcriber>;
  now?(): number;
}): SttProvider {
  const now = deps.now ?? Date.now;
  return {
    id: 'whisper',
    async start({
      signal,
      language,
      endSilenceMs = END_SILENCE_MS,
      continuous = false,
      livePartials = false,
    }) {
      // Load (or reuse) both models up front so the first words aren't lost while they load.
      const [vad, transcriber] = await Promise.all([deps.vad(), deps.transcriber()]);
      vad.reset();
      const handlers = new Map<string, Handler[]>();
      const fire = (event: string, ...args: unknown[]): void => {
        for (const h of handlers.get(event) ?? []) (h as (...a: unknown[]) => void)(...args);
      };
      let pending: Float32Array = new Float32Array(0);
      const preRoll: Float32Array[] = [];
      let speech: Float32Array[] = [];
      let inSpeech = false;
      let quietMs = 0;
      let done = false;
      let chain = Promise.resolve();
      /** Bumped per utterance so a late live re-read never overwrites a newer phrase. */
      let utterance = 0;
      let busy: Promise<unknown> | null = null;
      let lastPartialAt = 0;

      function livePartial(): void {
        if (!livePartials || busy || now() - lastPartialAt < PARTIAL_EVERY_MS) return;
        if (speech.length * WINDOW_MS < 500) return; // too short to read reliably
        const which = utterance;
        lastPartialAt = now();
        busy = transcriber
          .transcribe(joinWindows(speech), language)
          .then((text) => {
            if (!signal.aborted && !done && which === utterance && text) fire('partial', text);
          })
          .catch(() => undefined)
          .finally(() => {
            busy = null;
            lastPartialAt = now();
          });
      }

      async function finish(): Promise<void> {
        const audio = joinWindows(speech);
        utterance++;
        speech = [];
        inSpeech = false;
        quietMs = 0;
        if (!continuous) done = true;
        if (busy) await busy;
        const text = await transcriber.transcribe(audio, language);
        if (signal.aborted) return;
        if (text) fire('final', text);
        fire('utteranceEnd');
        if (continuous) vad.reset();
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
          preRoll.length = 0;
          fire('speechStarted');
          return;
        }
        speech.push(window);
        quietMs = p < END_PROB ? quietMs + WINDOW_MS : 0;
        if (quietMs >= endSilenceMs || speech.length * WINDOW_MS >= MAX_SPEECH_MS) await finish();
        else livePartial();
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
