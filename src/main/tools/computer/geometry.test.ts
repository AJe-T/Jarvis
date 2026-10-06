import { describe, expect, it } from 'vitest';
import {
  dipToShot,
  insideAny,
  physicalToShot,
  regionToPhysical,
  scaleFor,
  shotGeometry,
  shotToPhysical,
  type DisplayGeometry,
} from './geometry';

// Implementation.md Phase 6: the DPI calibration test comes before wiring clicks. These cases cover
// Windows display scaling at 100 %, 125 % and 150 % on common resolutions.
const displays: Array<[string, DisplayGeometry]> = [
  ['1920×1080 @100%', { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }],
  [
    '1920×1080 @125% (1536×864 DIP)',
    { bounds: { x: 0, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 },
  ],
  [
    '2560×1440 @150% (1707×960 DIP)',
    { bounds: { x: 0, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 },
  ],
  [
    '3840×2160 @150% (2560×1440 DIP)',
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 },
  ],
];

describe('screenshot geometry', () => {
  it('never exceeds 1568 px long edge or 1.15 MP', () => {
    for (const [, d] of displays) {
      const g = shotGeometry(d);
      expect(Math.max(g.shot.width, g.shot.height)).toBeLessThanOrEqual(1568);
      expect(g.shot.width * g.shot.height).toBeLessThanOrEqual(1_150_000 * 1.001);
    }
    expect(scaleFor(1024, 768)).toBe(1);
  });

  it.each(displays)('%s: round-trips screenshot ↔ physical within 2 px', (_label, d) => {
    const g = shotGeometry(d);
    for (const pt of [
      [0, 0],
      [g.shot.width / 2, g.shot.height / 2],
      [g.shot.width - 1, g.shot.height - 1],
      [123, 456],
    ] as Array<[number, number]>) {
      const phys = shotToPhysical(g, d, pt);
      const back = physicalToShot(g, d, phys);
      expect(Math.abs(back[0] - pt[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(back[1] - pt[1])).toBeLessThanOrEqual(2);
    }
  });

  it.each(displays)(
    '%s: a DIP cursor reading maps back to the clicked screenshot pixel',
    (_label, d) => {
      const g = shotGeometry(d);
      const target: [number, number] = [
        Math.round(g.shot.width * 0.7),
        Math.round(g.shot.height * 0.3),
      ];
      const phys = shotToPhysical(g, d, target);
      // Windows reports the cursor in DIPs to a DPI-aware Electron app.
      const dip = { x: phys.x / d.scaleFactor, y: phys.y / d.scaleFactor };
      const seen = dipToShot(g, d, dip);
      expect(Math.abs(seen[0] - target[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(seen[1] - target[1])).toBeLessThanOrEqual(2);
    },
  );

  it('clamps coordinates to the display', () => {
    const d = displays[0]?.[1] as DisplayGeometry;
    const g = shotGeometry(d);
    expect(shotToPhysical(g, d, [-50, 99_999])).toEqual({ x: 0, y: 1079 });
  });

  it('maps zoom regions to physical crops (corners in any order)', () => {
    const d = displays[3]?.[1] as DisplayGeometry; // 3840×2160 physical
    const g = shotGeometry(d);
    const r = regionToPhysical(g, [200, 100, 100, 50]);
    expect(r.x).toBe(Math.round(100 / g.scale));
    expect(r.width).toBeGreaterThan(0);
  });

  it('detects points inside Jarvis windows', () => {
    expect(insideAny({ x: 10, y: 10 }, [{ x: 0, y: 0, width: 100, height: 100 }])).toBe(true);
    expect(insideAny({ x: 100, y: 10 }, [{ x: 0, y: 0, width: 100, height: 100 }])).toBe(false);
  });
});
