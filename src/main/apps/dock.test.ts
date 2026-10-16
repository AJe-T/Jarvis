import { describe, expect, it } from 'vitest';
import { stack } from './dock';

describe('dock (ADR-040)', () => {
  it('stacks an app’s views top to bottom inside the panel, in window pixels', () => {
    expect(stack({ x: 100, y: 50, width: 400, height: 300 }, 1.25, [46, null])).toEqual([
      { x: 125, y: 63, width: 500, height: 46 },
      { x: 125, y: 109, width: 500, height: 329 },
    ]);
  });

  it('never gives a view a negative size', () => {
    const [bar, page] = stack({ x: 0, y: 0, width: 10, height: 20 }, 1, [46, null]);
    expect(bar?.height).toBe(20);
    expect(page?.height).toBe(0);
  });
});
