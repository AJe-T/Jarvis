import { describe, expect, it } from 'vitest';
import { KEEP_LEAD_MS, KEEP_TAIL_MS, trimSilence } from './trim';

const RATE = 24_000;
const ms = (n: number): number => (RATE * n) / 1000;

/** `lead` ms of near-silence, `voice` ms of tone, `tail` ms of near-silence. */
function sentence(lead: number, voice: number, tail: number): Float32Array {
  const w = new Float32Array(ms(lead + voice + tail)).fill(0.00001);
  for (let i = ms(lead); i < ms(lead + voice); i++) w[i] = 0.5 * Math.sin(i / 5);
  return w;
}

describe('trimSilence (TTS padding)', () => {
  it('cuts Kokoro-like padding down to the kept margins', () => {
    const out = trimSilence(sentence(260, 1000, 480), RATE);
    const kept = (out.length / RATE) * 1000;
    expect(kept).toBeGreaterThan(1000);
    expect(kept).toBeLessThanOrEqual(1000 + KEEP_LEAD_MS + KEEP_TAIL_MS + 1);
  });

  it('never cuts into the voice, and keeps padding shorter than the margins', () => {
    const wave = sentence(20, 500, 40);
    expect(trimSilence(wave, RATE)).toHaveLength(wave.length);
  });

  it('leaves silence and empty audio alone', () => {
    expect(trimSilence(new Float32Array(100), RATE)).toHaveLength(100);
    expect(trimSilence(new Float32Array(0), RATE)).toHaveLength(0);
  });
});
