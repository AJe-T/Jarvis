/**
 * 16 kHz → 24 kHz (OpenAI Realtime takes 24 kHz PCM): linear interpolation, carrying the last
 * sample between frames so the joins are seamless. Speech has little above 8 kHz, so this is enough.
 */
export function createUpsampler16to24() {
  let last = 0;
  let phase = 0; // position of the next output sample, in input samples after `last`
  return (frame: Int16Array): Int16Array => {
    const out: number[] = [];
    // Output every 2/3 of an input sample; t is measured from `last` (index -1).
    for (; phase < frame.length; phase += 2 / 3) {
      const i = Math.floor(phase);
      const frac = phase - i;
      const a = i === 0 ? last : (frame[i - 1] ?? 0);
      const b = frame[i] ?? 0;
      out.push(Math.round(a + (b - a) * frac));
    }
    phase -= frame.length;
    last = frame[frame.length - 1] ?? last;
    return Int16Array.from(out);
  };
}

export const toBase64 = (samples: Int16Array): string =>
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');

export const fromBase64 = (b64: string): Uint8Array => new Uint8Array(Buffer.from(b64, 'base64'));
