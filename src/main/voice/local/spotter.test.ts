import { describe, expect, it } from 'vitest';
import {
  SPOTTER_LEVELS,
  calibratedLevel,
  createCalibrator,
  createSpotterWake,
  keywordsText,
  spotterThreshold,
  wakePhrases,
  type KeywordEngine,
  type SpotterModel,
} from './spotter';

const PIECES = new Map(
  ['▁HE', 'Y', '▁JA', 'R', 'VI', 'S', '▁MA', 'X'].map((p) => [p, -1] as const),
);

describe('spotter keywords', () => {
  it('wakes on "Hey <name>" and a long enough bare name, plus learned spellings', () => {
    expect(wakePhrases('Jarvis')).toEqual(['HEY JARVIS', 'JARVIS']);
    expect(wakePhrases('Max')).toEqual(['HEY MAX']);
    expect(wakePhrases('Hey Jarvis', ['jarvis', 'sumer'])).toEqual([
      'HEY JARVIS',
      'JARVIS',
      'HEY SUMER',
      'SUMER',
    ]);
  });

  it('writes one line per spellable phrase with its threshold and label', () => {
    expect(keywordsText(['HEY JARVIS', 'JARVIS', 'HEY BOB'], PIECES, 0.25)).toBe(
      '▁HE Y ▁JA R VI S #0.25 @HEY_JARVIS\n▁JA R VI S #0.25 @JARVIS\n',
    );
    expect(() => keywordsText(['HEY BOB'], PIECES, 0.25)).toThrow(/wake phrase not spellable/);
  });

  it('maps sensitivity to a threshold; calibration can only make it more eager', () => {
    expect(spotterThreshold(0.6)).toBeCloseTo(0.25);
    expect(spotterThreshold(1)).toBeCloseTo(0.05);
    expect(spotterThreshold(0)).toBeCloseTo(0.5);
    expect(spotterThreshold(0.6, 0.1)).toBeCloseTo(0.1);
    expect(spotterThreshold(0.6, 0.45)).toBeCloseTo(0.25);
    expect(spotterThreshold(0.6, 0.01)).toBeCloseTo(0.05);
  });
});

/** Hears its phrase in any frame containing a sample at or above `loud`. */
function fakeEngine(loud = 0.5): KeywordEngine & { resets: number } {
  return {
    resets: 0,
    accept: (s) => (s.some((x) => x >= loud) ? 'HEY_JARVIS' : ''),
    reset() {
      this.resets++;
    },
  };
}

describe('spotter wake word', () => {
  it('fires once per phrase and not again within the debounce', () => {
    let t = 0;
    const heard: string[] = [];
    const wake = createSpotterWake(fakeEngine(), {
      now: () => t,
      onHeard: (p) => heard.push(p),
    });
    const quiet = new Int16Array(1280);
    const loud = new Int16Array(1280).fill(20000);
    expect(wake.frameLength).toBe(1280);
    expect(wake.process(quiet)).toBe(false);
    expect(wake.process(loud)).toBe(true);
    t = 1000;
    expect(wake.process(loud)).toBe(false);
    t = 2500;
    expect(wake.process(loud)).toBe(true);
    expect(heard).toEqual(['HEY_JARVIS', 'HEY_JARVIS']);
  });
});

describe('spotter calibration', () => {
  it('finds the strictest level each phrase passes', async () => {
    const opened: string[] = [];
    const model: SpotterModel = {
      pieces: PIECES,
      async open(keywords) {
        opened.push(keywords);
        const level = Number(/#([\d.]+)/.exec(keywords)?.[1]);
        // The phrase's peak sample stands in for how sure the spotter is.
        return fakeEngine(level * 2);
      },
    };
    const cal = createCalibrator(model, ['HEY JARVIS']);
    expect(await cal.level(new Float32Array(16000).fill(0.65))).toBe(0.3);
    expect(await cal.level(new Float32Array(16000).fill(1))).toBe(0.5);
    expect(await cal.level(new Float32Array(16000).fill(0.01))).toBe(0);
    expect(opened).toHaveLength(SPOTTER_LEVELS.length); // built once, reused
  });

  it('forgives one bad take out of four or more', () => {
    expect(calibratedLevel([0.5, 0.4, 0.45, 0.1, 0.5])).toBe(0.4);
    expect(calibratedLevel([0.5, 0.4, 0.1])).toBe(0.1);
    expect(calibratedLevel([0.5, 0, 0, 0.4])).toBe(0);
    expect(calibratedLevel([])).toBe(0);
  });
});
