import type { WakeWord } from '../types';

/** One wake per phrase even when both engines hear it (they fire a few frames apart). */
const DEBOUNCE_MS = 2000;

/**
 * Voice v2: two wake engines on the same frames; either one hearing the name wakes Jarvis. The
 * engines are trained differently (keyword spotting on word pieces vs a "hey jarvis" classifier), so
 * together they miss fewer of Sir's "Hey Jarvis"es than either alone (voice-bench.real.test.ts).
 * Both must take the same frame length.
 */
export function eitherWake(a: WakeWord, b: WakeWord, now: () => number = Date.now): WakeWord {
  if (a.frameLength !== b.frameLength) throw new Error('wake engines need the same frame length');
  let lastFire = -Infinity;
  const fire = (heard: boolean): boolean => {
    if (!heard || now() - lastFire < DEBOUNCE_MS) return false;
    lastFire = now();
    return true;
  };
  return {
    frameLength: a.frameLength,
    process(frame) {
      const ra = a.process(frame);
      const rb = b.process(frame);
      if (typeof ra === 'boolean' && typeof rb === 'boolean') return fire(ra || rb);
      return Promise.all([ra, rb]).then(([x, y]) => fire(x || y));
    },
    reset() {
      a.reset();
      b.reset();
    },
    release() {
      a.release();
      b.release();
    },
  };
}
