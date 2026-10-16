import { describe, expect, it } from 'vitest';
import { bubbleScale, hexSpiral } from './honeycomb';

describe('hexSpiral', () => {
  it('puts one bubble in the centre, six around it, then twelve', () => {
    const spots = hexSpiral(19);
    expect(spots.map((s) => s.ring)).toEqual([
      0,
      ...Array<number>(6).fill(1),
      ...Array<number>(12).fill(2),
    ]);
    // Ring 1 touches the centre: every neighbour is exactly one bubble away.
    for (const s of spots.slice(1, 7)) expect(Math.hypot(s.x, s.y)).toBeCloseTo(1);
  });

  it('never stacks two bubbles on the same spot', () => {
    const spots = hexSpiral(37);
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i]!;
        const b = spots[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.99);
      }
  });

  it('bubbles shrink toward the edge and swell under the pointer', () => {
    const [centre, , , , , , , outer] = hexSpiral(8);
    expect(bubbleScale(centre!, null)).toBeGreaterThan(bubbleScale(outer!, null));
    expect(bubbleScale(outer!, { x: outer!.x, y: outer!.y })).toBeGreaterThan(
      bubbleScale(centre!, { x: outer!.x, y: outer!.y }),
    );
  });
});
