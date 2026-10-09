import { describe, expect, it } from 'vitest';
import { CAPTION_WIDTH, ORB_SIZE, TAB, dropDock, miniBounds } from './mini-dock';

const area = { x: 0, y: 0, width: 1920, height: 1040 };

describe('mini orb dock', () => {
  it('sits on its edge, grows inward for the caption, and stays on screen', () => {
    const right = { px: 1900, y: 900, side: 'right' as const, tucked: false };
    expect(miniBounds(right, area, false)).toEqual({
      x: 1920 - 12 - ORB_SIZE,
      y: 900,
      width: ORB_SIZE,
      height: ORB_SIZE,
    });
    expect(miniBounds(right, area, true).x).toBe(1920 - 12 - ORB_SIZE - CAPTION_WIDTH);
    expect(miniBounds({ ...right, y: 5000 }, area, false).y).toBe(1040 - ORB_SIZE);
    expect(miniBounds({ ...right, side: 'left' }, area, true).x).toBe(12);
  });

  it('tucks into a slim handle flush with the edge', () => {
    expect(miniBounds({ px: 5, y: 300, side: 'left', tucked: true }, area, true)).toEqual({
      x: 0,
      y: 300,
      ...TAB,
    });
    expect(miniBounds({ px: 1900, y: 300, side: 'right', tucked: true }, area, false).x).toBe(
      1920 - TAB.width,
    );
  });

  it('snaps a drop to the nearer edge and tucks when pushed past it', () => {
    expect(
      dropDock({ x: 400, y: 200, width: ORB_SIZE, height: ORB_SIZE }, area, false),
    ).toMatchObject({ side: 'left', tucked: false, y: 200 });
    expect(dropDock({ x: 1500, y: 200, width: ORB_SIZE, height: ORB_SIZE }, area, false).side).toBe(
      'right',
    );
    expect(
      dropDock({ x: -40, y: 200, width: ORB_SIZE, height: ORB_SIZE }, area, false).tucked,
    ).toBe(true);
    // Dragging the tucked handle along the edge keeps it tucked.
    expect(dropDock({ x: 1906, y: 500, ...TAB }, area, true)).toMatchObject({
      side: 'right',
      tucked: true,
    });
  });
});
