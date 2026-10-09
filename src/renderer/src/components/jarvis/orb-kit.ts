import type { AssistantState } from '@shared/types';

/** One segment per tool call while ACTING (§6.1). */
export type OrbStep = 'pending' | 'running' | 'done' | 'error';

export interface OrbFrame {
  state: AssistantState;
  /** Raw RMS of whatever the orb follows (voice or music), 0..~0.3. */
  level: number;
  steps: readonly OrbStep[];
}

export type Rgb = readonly [number, number, number];
export type Vec = readonly [number, number, number];

export interface Palette {
  main: Rgb;
  deep: Rgb;
  hi: Rgb;
  /** Second neon. */
  alt: Rgb;
  /** Third neon: sparks and markers. */
  mark: Rgb;
  lamp: Rgb;
  alarm: Rgb;
  dim: Rgb;
  /** Additive glow only works on dark backgrounds. */
  light: boolean;
}

/** Everything a style needs for one frame. */
export interface Env {
  ctx: CanvasRenderingContext2D;
  size: number;
  /** Half the size: styles draw around (R, R). */
  R: number;
  t: number;
  dt: number;
  /** 0..1: the level with a fast attack, slow release and a resting breath. */
  e: number;
  /** Accumulated turn (radians); faster while listening or thinking. */
  spin: number;
  still: boolean;
  p: Palette;
  /** The state colour (accent, yellow when waiting, red on error, grey asleep). */
  c: Rgb;
  /** The second neon (red on error). */
  alt: Rgb;
  f: OrbFrame;
  /** Big enough for fine detail (64px and up). */
  hud: boolean;
}

export interface OrbStyle {
  draw(env: Env): void;
  /** True when the style shows ACTING tool segments itself; otherwise the base adds a ring. */
  ownsSteps?: boolean;
}
export type OrbStyleFactory = (size: number) => OrbStyle;

export const TAU = Math.PI * 2;
export const HUD_MIN_PX = 64;

function hexToRgb(value: string, fallback: Rgb): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m?.[1]) return fallback;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: Rgb): Rgb => hexToRgb(css.getPropertyValue(name), fallback);
  return {
    main: v('--orb-1', [0, 240, 255]),
    deep: v('--orb-2', [0, 20, 28]),
    hi: v('--orb-hi', [234, 253, 255]),
    alt: v('--orb-3', [122, 92, 255]),
    mark: v('--orb-4', [252, 238, 10]),
    lamp: v('--lamp-400', [252, 238, 10]),
    alarm: v('--alarm-500', [255, 77, 109]),
    dim: v('--ink-500', [125, 147, 168]),
    light: document.documentElement.dataset['theme'] === 'light',
  };
}

export const rgba = ([r, g, b]: Rgb, a: number): string =>
  `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Evenly spread points on a unit sphere. */
export function fibonacciSphere(n: number): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    pts.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  return pts;
}

/** Cheap smooth 3D "noise": a few crossed sines, roughly -1..1. */
export function wobble(x: number, y: number, z: number, t: number): number {
  return (
    (Math.sin(2.1 * x + 1.3 * t) * Math.cos(1.7 * y - 0.9 * t) +
      0.5 * Math.sin(3.3 * z + 2.1 * y + 1.7 * t) +
      0.35 * Math.sin(4.1 * x - 3.7 * z - 1.1 * t)) /
    1.85
  );
}

/** Rotates a point around Y by `yaw`, then around X by `pitch`; returns [x, y, depth -1..1]. */
export function project([x, y, z]: Vec, yaw: number, pitch: number): Vec {
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)];
  const [cx, sx] = [Math.cos(pitch), Math.sin(pitch)];
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
}

/** Soft radial glow at (x, y). */
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  c: Rgb,
  a: number,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** 'lighter' on dark themes (neon adds up), normal painting on light ones. */
export const additive = (env: Env): GlobalCompositeOperation =>
  env.p.light ? 'source-over' : 'lighter';

export function toneFor(state: AssistantState, p: Palette): Rgb {
  if (state === 'AWAITING_CONFIRMATION') return p.lamp;
  if (state === 'ERROR') return p.alarm;
  if (state === 'SLEEP') return p.dim;
  return p.main;
}

/** Colour of one of n segments for the current frame (ACTING steps, THINKING sweep, else the level). */
export function segmentColour(env: Env, i: number, n: number): string {
  const { f, c, p, t, spin, e } = env;
  if (f.state === 'THINKING')
    return rgba(c, 0.15 + 0.85 * Math.max(0, Math.cos((i / n) * TAU - spin * 2.2)));
  if (f.state === 'ACTING' && f.steps.length) {
    const step = f.steps[Math.floor((i / n) * f.steps.length)];
    if (step === 'error') return rgba(p.alarm, 0.95);
    if (step === 'done') return rgba(c, 0.95);
    if (step === 'running') return rgba(c, 0.45 + 0.45 * Math.sin(t * 6));
    return rgba(p.dim, 0.35);
  }
  return rgba(c, 0.4 + e * 0.55);
}
