/**
 * Cuts the quiet a voice model pads around each sentence (idea from huwprosser/jarvis-mlx, which
 * trims its TTS output before playing it). Measured 2026-11-04 on this laptop: Kokoro adds about
 * 250 ms before and 450–500 ms after every sentence, Piper about 40 ms and 150 ms. Sentences play
 * back to back, so that was up to 0.75 s of dead air between them and a later first word.
 */

/** Quieter than this, relative to the sentence's loudest sample, counts as silence. */
export const TRIM_FLOOR_DB = -50;
/** Kept before the first sound, so a soft "h" or "f" isn't clipped. */
export const KEEP_LEAD_MS = 60;
/** Kept after the last sound: a natural pause before the next sentence. */
export const KEEP_TAIL_MS = 150;

export function trimSilence(wave: Float32Array, sampleRate: number): Float32Array {
  let peak = 0;
  for (const x of wave) peak = Math.max(peak, Math.abs(x));
  if (peak === 0) return wave;
  const floor = peak * 10 ** (TRIM_FLOOR_DB / 20);
  const loud = (i: number): boolean => Math.abs(wave[i] ?? 0) >= floor;
  let first = 0;
  while (!loud(first)) first++;
  let last = wave.length - 1;
  while (!loud(last)) last--;
  const start = Math.max(0, first - Math.round((sampleRate * KEEP_LEAD_MS) / 1000));
  const end = Math.min(wave.length, last + 1 + Math.round((sampleRate * KEEP_TAIL_MS) / 1000));
  return wave.subarray(start, end);
}
