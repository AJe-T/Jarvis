import type { WakeTemplates } from '../local/personal-wake';

/**
 * Voice fix 1B: messages between the main process and the audio worker (a utility process that
 * runs the real-time models: wake words and the Silero voice detector). Every frame or window
 * gets exactly one reply, in order, per engine id.
 */

/** A wake engine to open in the worker; paths are model folders main already verified. */
export type WakeSpec =
  | { engine: 'openwakeword'; dir: string; threshold: number }
  | {
      engine: 'personal';
      dir: string;
      templates: WakeTemplates;
      sensitivity: number;
      /** Also the "hey jarvis" model at this threshold (default name). */
      classifierThreshold?: number;
    }
  | { engine: 'spotter'; dir: string; phrases: string[]; threshold: number };

export type ToWorker =
  | { t: 'wake-open'; id: number; spec: WakeSpec }
  | { t: 'wake-frame'; id: number; frame: Int16Array }
  | { t: 'wake-reset'; id: number }
  | { t: 'vad-open'; id: number; path: string }
  | { t: 'vad-prob'; id: number; window: Float32Array }
  | { t: 'vad-reset'; id: number }
  | { t: 'close'; id: number };

export type FromWorker =
  | { t: 'opened'; id: number; frameLength: number }
  | { t: 'open-failed'; id: number; error: string }
  /** One per wake-frame: was the wake word heard, and how long inference took. */
  | { t: 'wake'; id: number; heard: boolean; ms: number }
  /** One per vad-prob: the speech probability of that window. */
  | { t: 'prob'; id: number; p: number; ms: number }
  /** A frame or window failed; the engine is unusable after this. */
  | { t: 'error'; id: number; error: string }
  | { t: 'log'; level: 'info' | 'warn'; obj: Record<string, unknown>; msg: string };
