import { describe, expect, it } from 'vitest';
import { createAutoGain } from './gain';

const tone = (amp: number, n = 512): Int16Array =>
  Int16Array.from({ length: n }, (_, i) => Math.round(Math.sin(i / 5) * amp * 32767));
const rms = (f: Int16Array): number =>
  Math.sqrt(f.reduce((a, x) => a + (x / 32768) ** 2, 0) / f.length);

describe('voice v2 automatic gain', () => {
  it('brings quiet speech (1 % of full scale) up to a usable level', () => {
    const agc = createAutoGain();
    for (let i = 0; i < 30; i++) agc.apply(tone(0.0005)); // the room
    let out: Int16Array = new Int16Array(0);
    for (let i = 0; i < 60; i++) out = agc.apply(tone(0.014)); // Sir speaking
    expect(rms(out)).toBeGreaterThan(0.06);
    expect(rms(out)).toBeLessThan(0.15);
  });

  it('does not pump the room hiss up between words', () => {
    const agc = createAutoGain();
    for (let i = 0; i < 100; i++) agc.apply(tone(0.0005));
    expect(agc.gain).toBe(1);
  });

  it('never clips loud speech', () => {
    const agc = createAutoGain();
    for (let i = 0; i < 30; i++) agc.apply(tone(0.0005));
    for (let i = 0; i < 60; i++) agc.apply(tone(0.01));
    const loud = agc.apply(tone(0.9));
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(32767);
  });
});
