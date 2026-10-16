import { describe, expect, it } from 'vitest';
import { buildProfile, cosine, decodeProfile, encodeProfile, normalize } from './speaker';

/** A fake 512-number voice: a base direction plus a little per-phrase wobble. */
function voice(seed: number, wobble: number, phrase: number): Float32Array {
  return Float32Array.from(
    { length: 512 },
    (_, i) => Math.sin(i * seed) + wobble * Math.cos(i * (phrase + 1) * 0.37),
  );
}

describe('Voice Match maths (ADR-039)', () => {
  it('normalises to unit length and scores identical voices as 1', () => {
    const v = voice(0.1, 0, 0);
    const n = normalize(v);
    expect(Math.hypot(...n)).toBeCloseTo(1);
    expect(cosine(v, v)).toBeCloseTo(1);
  });

  it('sets the threshold just under the weakest phrase, within sane limits', () => {
    const phrases = [0, 1, 2, 3, 4].map((p) => voice(0.1, 0.3, p));
    const p = buildProfile(phrases);
    expect(p.scores).toHaveLength(5);
    expect(p.threshold).toBeGreaterThanOrEqual(0.55);
    expect(p.threshold).toBeLessThanOrEqual(0.9);
    expect(p.threshold).toBeLessThan(Math.min(...p.scores));
    // Sir's phrases pass; a different voice does not.
    expect(cosine(voice(0.1, 0.3, 7), p.centroid)).toBeGreaterThan(p.threshold);
    expect(cosine(voice(0.23, 0.3, 1), p.centroid)).toBeLessThan(p.threshold);
  });

  it('round-trips the stored profile and refuses anything else', () => {
    const c = normalize(voice(0.1, 0, 0));
    const back = decodeProfile(encodeProfile(c, 5, 123));
    expect([...back.centroid]).toEqual([...c]);
    expect(back.samples).toBe(5);
    expect(() => decodeProfile('{"v":2}')).toThrow('unknown voice profile');
    expect(() =>
      decodeProfile(JSON.stringify({ v: 1, model: 'wavlm-speaker', centroid: 'AAAA' })),
    ).toThrow('bad voice profile');
  });

  it('needs at least two phrases', () => {
    expect(() => buildProfile([voice(0.1, 0, 0)])).toThrow();
  });
});
