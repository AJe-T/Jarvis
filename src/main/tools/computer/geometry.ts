// API-Guide.md §7 + official computer-use docs (checked 2026-10-06): Claude's coordinates are in the
// pixel space of the screenshots we send. We downscale screenshots (≤ 1568 px long edge and ≤ 1.15 MP)
// and map coordinates back. Electron's `screen` works in DIPs; nut.js and screenshots use physical pixels.

export const MAX_LONG_EDGE = 1568;
export const MAX_PIXELS = 1_150_000;

export interface DisplayGeometry {
  /** Primary display bounds in DIPs (Electron `screen`). */
  bounds: { x: number; y: number; width: number; height: number };
  /** Windows display scaling (1, 1.25, 1.5, …). */
  scaleFactor: number;
}

export interface ShotGeometry {
  /** Physical size of the display. */
  physical: { width: number; height: number };
  /** Size of the screenshot Claude sees. */
  shot: { width: number; height: number };
  /** shot = physical × scale (≤ 1). */
  scale: number;
}

export function scaleFor(
  width: number,
  height: number,
  maxLongEdge = MAX_LONG_EDGE,
  maxPixels = MAX_PIXELS,
): number {
  return Math.min(
    1,
    maxLongEdge / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  );
}

export function shotGeometry(d: DisplayGeometry): ShotGeometry {
  const physical = {
    width: Math.round(d.bounds.width * d.scaleFactor),
    height: Math.round(d.bounds.height * d.scaleFactor),
  };
  const scale = scaleFor(physical.width, physical.height);
  return {
    physical,
    shot: {
      width: Math.round(physical.width * scale),
      height: Math.round(physical.height * scale),
    },
    scale,
  };
}

/** Screenshot pixel → physical pixel on the primary display (what nut.js moves to). */
export function shotToPhysical(
  g: ShotGeometry,
  d: DisplayGeometry,
  [x, y]: readonly [number, number],
): { x: number; y: number } {
  const px = Math.min(g.physical.width - 1, Math.max(0, Math.round(x / g.scale)));
  const py = Math.min(g.physical.height - 1, Math.max(0, Math.round(y / g.scale)));
  return {
    x: Math.round(d.bounds.x * d.scaleFactor) + px,
    y: Math.round(d.bounds.y * d.scaleFactor) + py,
  };
}

/** Physical pixel → screenshot pixel (for cursor_position). */
export function physicalToShot(
  g: ShotGeometry,
  d: DisplayGeometry,
  p: { x: number; y: number },
): [number, number] {
  return [
    Math.round((p.x - d.bounds.x * d.scaleFactor) * g.scale),
    Math.round((p.y - d.bounds.y * d.scaleFactor) * g.scale),
  ];
}

/** DIP point (Electron `screen.getCursorScreenPoint`) → screenshot pixel. Used by the calibration check. */
export function dipToShot(
  g: ShotGeometry,
  d: DisplayGeometry,
  p: { x: number; y: number },
): [number, number] {
  return physicalToShot(g, d, { x: p.x * d.scaleFactor, y: p.y * d.scaleFactor });
}

/** A screenshot-space rectangle → physical crop rectangle (for zoom). */
export function regionToPhysical(
  g: ShotGeometry,
  region: readonly [number, number, number, number],
): { x: number; y: number; width: number; height: number } {
  const [x0, y0, x1, y1] = region;
  const left = Math.max(0, Math.round(Math.min(x0, x1) / g.scale));
  const top = Math.max(0, Math.round(Math.min(y0, y1) / g.scale));
  const right = Math.min(g.physical.width, Math.round(Math.max(x0, x1) / g.scale));
  const bottom = Math.min(g.physical.height, Math.round(Math.max(y0, y1) / g.scale));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Is a DIP point inside any of these DIP rectangles (Jarvis's own windows)? */
export function insideAny(
  p: { x: number; y: number },
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return rects.some((r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height);
}
