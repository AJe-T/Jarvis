import { describe, expect, it } from 'vitest';
import type { WakeWord } from '../types';
import { adviceFor, speechLevelDb, wakeHears } from './check';

const tone = (amp: number, n = 16000): Float32Array =>
  Float32Array.from({ length: n }, (_, i) => Math.sin(i / 5) * amp);

describe('voice v2 check', () => {
  it('measures the loud part of a recording', () => {
    const half = new Float32Array(32000);
    half.set(tone(0.1), 16000); // 1 s of silence, then speech at about -23 dB
    expect(speechLevelDb(half)).toBeGreaterThanOrEqual(-24);
    expect(speechLevelDb(half)).toBeLessThanOrEqual(-22);
    expect(speechLevelDb(new Float32Array(0))).toBe(-120);
  });

  it('runs the recording through the wake word frame by frame', async () => {
    let frames = 0;
    const wake: WakeWord = {
      frameLength: 1280,
      process: () => ++frames === 10,
      reset: () => undefined,
      release: () => undefined,
    };
    expect(await wakeHears(wake, tone(0.1))).toBe(true);
    expect(frames).toBeGreaterThan(30); // padding before and after
  });

  it('says what to fix first', () => {
    const base = {
      recorded: true,
      heard: 'hey jarvis what time is it',
      engine: 'Deepgram',
      wake: true,
      levelDb: -22,
      ms: 900,
    };
    expect(adviceFor({ ...base, recorded: false }, 'Jarvis')).toMatch(/Nothing was heard/);
    expect(adviceFor({ ...base, levelDb: -50 }, 'Jarvis')).toMatch(/very quiet/);
    expect(adviceFor({ ...base, wake: false }, 'Jarvis')).toMatch(/wake word didn't fire/);
    expect(adviceFor({ ...base, ms: 6000 }, 'Jarvis')).toMatch(/slow/);
    expect(adviceFor(base, 'Jarvis')).toBe('');
  });
});
