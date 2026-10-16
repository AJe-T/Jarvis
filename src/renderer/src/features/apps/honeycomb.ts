/**
 * Apple Watch style app cloud: bubbles on a hex grid, centre first, then ring after ring around it.
 * Positions are in "bubble units" (neighbours are exactly 1 apart); the view scales them to pixels.
 */
export interface HexSpot {
  x: number;
  y: number;
  ring: number;
}

// Axial hex directions, in walking order around a ring.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

const toXY = (q: number, r: number, ring: number): HexSpot => ({
  x: q + r / 2,
  y: (r * Math.sqrt(3)) / 2,
  ring,
});

export function hexSpiral(n: number): HexSpot[] {
  if (n <= 0) return [];
  const out: HexSpot[] = [toXY(0, 0, 0)];
  for (let k = 1; out.length < n; k++) {
    // Each ring starts k steps out in direction 4, then walks its six sides.
    let q = -k;
    let r = k;
    for (const [dq, dr] of DIRS)
      for (let step = 0; step < k; step++) {
        out.push(toXY(q, r, k));
        q += dq;
        r += dr;
      }
  }
  return out.slice(0, n);
}

/**
 * Bubble size: shrinks toward the edge like the Watch, and swells near the pointer when there is
 * one (distance in bubble units).
 */
export function bubbleScale(spot: HexSpot, pointer: { x: number; y: number } | null): number {
  if (!pointer) return Math.max(0.72, 1.06 - spot.ring * 0.12);
  const d = Math.hypot(spot.x - pointer.x, spot.y - pointer.y);
  return Math.min(1.22, Math.max(0.62, 1.24 - d * 0.2));
}
