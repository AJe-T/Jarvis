import type { Recorder } from '../types';

/** Speech is brought up to about this level (RMS of full scale, ≈ -20 dBFS). */
const TARGET_RMS = 0.1;
/** Never more than this much gain (40 dB): a silent room must not become loud hiss. */
const MAX_GAIN = 100;
/** A frame counts as speech when it is this many times louder than the room. */
const SPEECH_OVER_NOISE = 3;
/** How fast the gain moves toward what speech needs (per speech frame). */
const ATTACK = 0.08;

const rmsOf = (f: Int16Array): number => {
  let s = 0;
  for (const x of f) s += (x / 32768) ** 2;
  return Math.sqrt(s / (f.length || 1));
};

/**
 * Voice v2: digital automatic gain for microphones that arrive without it (the native recorder, or
 * a capture device whose own gain is off). Laptop mic arrays deliver speech at ~1 % of full scale,
 * where the wake word and speech recognition hear mostly noise. The gain follows speech only (frames
 * well above the room's level), changes smoothly, and a soft limiter keeps loud speech from clipping.
 */
export function createAutoGain() {
  let noise = 0.01;
  let gain = 1;
  return {
    get gain(): number {
      return gain;
    },
    apply(frame: Int16Array): Int16Array {
      const rms = rmsOf(frame);
      // The room's level: follows quiet frames down at once, creeps up slowly.
      noise = rms < noise ? rms : noise * 1.002;
      if (rms > Math.max(0.0015, noise * SPEECH_OVER_NOISE)) {
        const want = Math.min(MAX_GAIN, Math.max(1, TARGET_RMS / rms));
        gain += (want - gain) * ATTACK;
      }
      const out = new Int16Array(frame.length);
      for (let i = 0; i < frame.length; i++) {
        const x = ((frame[i] ?? 0) / 32768) * gain;
        // Soft limiter: linear up to 0.5, then smoothly toward ±1.
        const y =
          Math.abs(x) <= 0.5
            ? x
            : Math.sign(x) * (0.5 + 0.5 * Math.tanh((Math.abs(x) - 0.5) / 0.5));
        out[i] = Math.round(y * 32767);
      }
      return out;
    },
  };
}

/** A recorder whose frames go through automatic gain. */
export function withAutoGain(rec: Recorder): Recorder {
  const agc = createAutoGain();
  return {
    frameLength: rec.frameLength,
    start: () => rec.start(),
    stop: () => rec.stop(),
    read: async () => agc.apply(await rec.read()),
    release: () => rec.release(),
    get isRecording() {
      return rec.isRecording;
    },
  };
}
