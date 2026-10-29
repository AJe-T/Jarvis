import { describe, expect, it } from 'vitest';
import type { WakeWord } from '../types';
import { eitherWake } from './wake';

const engine = (hears: (n: number) => boolean, async = false): WakeWord & { resets: number } => {
  let n = 0;
  return {
    frameLength: 1280,
    resets: 0,
    process: () => {
      const r = hears(n++);
      return async ? Promise.resolve(r) : r;
    },
    reset() {
      this.resets++;
    },
    release: () => undefined,
  };
};

describe('voice v2: either wake engine wakes Jarvis', () => {
  it('fires when only one of them hears the name, once per phrase', async () => {
    let t = 0;
    const w = eitherWake(
      engine((n) => n === 3),
      engine((n) => n === 4, true),
      () => t,
    );
    const out: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      t += 80;
      out.push(await w.process(new Int16Array(1280)));
    }
    expect(out.filter(Boolean)).toHaveLength(1); // the second engine's hit 80 ms later is the same phrase
    expect(out[3]).toBe(true);
  });

  it('resets both', () => {
    const a = engine(() => false);
    const b = engine(() => false);
    eitherWake(a, b).reset();
    expect([a.resets, b.resets]).toEqual([1, 1]);
  });
});
