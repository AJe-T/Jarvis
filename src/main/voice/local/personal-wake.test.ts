import { describe, expect, it } from 'vitest';
import { EMBEDDING, OWW_CHUNK, type OwwModels } from './open-wake-word';
import {
  buildTemplates,
  createPersonalWake,
  decodeTemplates,
  distanceThreshold,
  encodeTemplates,
  matchDistance,
  phraseFeatures,
  type PhraseFeatures,
} from './personal-wake';

/** A unit vector pointing mostly along axis `k` (distinct "sounds"), as the wake engine keeps them. */
function sound(k: number, wobble = 0): Float32Array {
  const v = new Float32Array(EMBEDDING).fill(0.01);
  v[k] = 1;
  v[(k + 1) % EMBEDDING] = wobble;
  const len = Math.hypot(...v);
  return v.map((x) => x / len);
}
const word = (ks: number[], wobble = 0): Float32Array[] => ks.map((k) => sound(k, wobble));
const HEY_JARVIS = [1, 2, 3, 4, 5, 6, 7];

describe('personal wake word (ADR-040)', () => {
  it('subsequence DTW: same phrase ≈ 0, slower phrase small, other phrase large', () => {
    const t = word(HEY_JARVIS);
    expect(matchDistance(t, t)).toBeCloseTo(0, 5);
    const slow = word([9, 9, 1, 1, 2, 3, 3, 4, 5, 5, 6, 7]); // silence first, then stretched
    expect(matchDistance(t, slow)).toBeLessThan(0.05);
    expect(matchDistance(t, word([20, 21, 22, 23, 24, 25, 26]))).toBeGreaterThan(0.5);
    expect(matchDistance(t, [])).toBe(Infinity);
  });

  it('builds templates from the loud part of each phrase and refuses unusable recordings', () => {
    const phrase = (wobble: number): PhraseFeatures => ({
      embeddings: [...word([0, 0]), ...word(HEY_JARVIS, wobble), ...word([0, 0, 0, 0, 0])],
      loud: [false, false, ...HEY_JARVIS.map(() => true), false, false, false, false, false],
    });
    const built = buildTemplates([phrase(0), phrase(0.1), phrase(0.2)]);
    expect(built?.templates).toHaveLength(3);
    expect(built?.templates[0]).toHaveLength(HEY_JARVIS.length + 3); // + the tail the window still hears
    expect(built?.spread).toBeGreaterThan(0);
    expect(buildTemplates([phrase(0)])).toBeNull(); // one phrase can't show Sir's own variation
    const silent = { embeddings: word([0, 0, 0, 0, 0]), loud: [false, false, false, false, false] };
    expect(buildTemplates([silent, silent])).toBeNull();
  });

  it('threshold follows the spread of his phrases, within bounds', () => {
    expect(distanceThreshold(0.2, 0.6)).toBeCloseTo(0.152);
    expect(distanceThreshold(0.2, 1)).toBeCloseTo(0.2);
    expect(distanceThreshold(0.01, 0.6)).toBe(0.06);
    expect(distanceThreshold(5, 0.6)).toBe(0.3);
  });

  it('stores templates as a validated string (round trip; tampering rejected)', () => {
    const t = {
      mean: new Float32Array(EMBEDDING),
      templates: [word(HEY_JARVIS), word(HEY_JARVIS)],
      spread: 0.1,
    };
    const back = decodeTemplates(encodeTemplates(t));
    expect(back.templates.map((x) => x.length)).toEqual([7, 7]);
    expect(Array.from(back.templates[1]?.[2] ?? [])).toEqual(Array.from(sound(3)));
    const raw = JSON.parse(encodeTemplates(t)) as Record<string, unknown>;
    expect(() => decodeTemplates(JSON.stringify({ ...raw, lengths: [7, 99] }))).toThrow();
    expect(() => decodeTemplates(JSON.stringify({ ...raw, spread: -1 }))).toThrow();
    expect(() => decodeTemplates(JSON.stringify({ ...raw, model: 'other' }))).toThrow();
  });

  /** Models whose embedding for a chunk is the "sound" written in its first sample. */
  function scriptedModels(score = 0): OwwModels & { released: boolean } {
    let lastSample = 0;
    const m = {
      released: false,
      async mel(audio: Float32Array) {
        lastSample = audio[audio.length - OWW_CHUNK] ?? 0;
        return new Float32Array(8 * 32);
      },
      async embed() {
        return sound(Math.round(lastSample));
      },
      async classify() {
        return score;
      },
      release() {
        m.released = true;
      },
    };
    return m;
  }
  /** One 80 ms chunk saying sound `k` (loud) or silence (k = 0). */
  const chunk = (k: number): Int16Array => {
    const c = new Int16Array(OWW_CHUNK).fill(k ? 3000 : 0);
    c[0] = k;
    return c;
  };

  it('wakes on his phrase, once (debounced), never on silence or other words', async () => {
    let now = 0;
    const templates = {
      mean: new Float32Array(EMBEDDING),
      templates: [word(HEY_JARVIS), word([1, 2, 3, 3, 4, 5, 6, 7])],
      spread: 0.1,
    };
    const models = scriptedModels();
    const ww = createPersonalWake(models, templates, { sensitivity: 0.6, now: () => now });
    const say = async (ks: number[]): Promise<boolean> => {
      let fired = false;
      for (const k of ks) {
        now += 80;
        if (await ww.process(chunk(k))) fired = true;
      }
      return fired;
    };
    expect(await say([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
    expect(await say([20, 21, 22, 23, 24, 25, 26, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
    expect(await say([...HEY_JARVIS, 0])).toBe(true);
    expect(await say([...HEY_JARVIS])).toBe(false); // within the 2 s debounce
    now += 3000;
    expect(await say([...HEY_JARVIS, 0])).toBe(true);
    ww.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(models.released).toBe(true);
  });

  it('with the default name the "hey jarvis" model can wake him too', async () => {
    const templates = {
      mean: new Float32Array(EMBEDDING),
      templates: [word(HEY_JARVIS), word(HEY_JARVIS)],
      spread: 0.1,
    };
    const ww = createPersonalWake(scriptedModels(0.9), templates, {
      sensitivity: 0.6,
      classifierThreshold: 0.5,
    });
    let fired = false;
    for (let i = 0; i < 30; i++) if (await ww.process(chunk(i % 2 ? 40 : 41))) fired = true;
    expect(fired).toBe(true);
  });

  it('reports a near miss once the phrase ends', async () => {
    const templates = {
      mean: new Float32Array(EMBEDDING),
      templates: [word(HEY_JARVIS), word(HEY_JARVIS)],
      spread: 0.5,
    };
    const near: number[] = [];
    const ww = createPersonalWake(scriptedModels(), templates, {
      sensitivity: 0,
      onNearMiss: (d) => near.push(d),
    });
    // Close but not close enough: two sounds wrong.
    for (const k of [1, 2, 30, 4, 31, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0]) await ww.process(chunk(k));
    expect(near).toHaveLength(1);
  });

  it('turns an enrolment phrase into features, one per 80 ms', async () => {
    const audio = new Float32Array(16000).fill(0.2); // 1 s of "speech"
    const f = await phraseFeatures(scriptedModels(), audio);
    expect(f.embeddings.length).toBe(f.loud.length);
    expect(f.loud.filter(Boolean).length).toBeGreaterThanOrEqual(12);
    expect(f.loud[0]).toBe(false); // the half second of silence before
  });
});
