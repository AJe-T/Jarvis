import type { AssistantState } from '@shared/types';

/** One segment per tool call while ACTING (§6.1). */
export type OrbStep = 'pending' | 'running' | 'done' | 'error';

export interface OrbFrame {
  state: AssistantState;
  /** Raw RMS of whatever the orb follows (voice or music), 0..~0.3. */
  level: number;
  steps: readonly OrbStep[];
}

type Rgb = readonly [number, number, number];

interface Palette {
  main: Rgb;
  deep: Rgb;
  hi: Rgb;
  lamp: Rgb;
  alarm: Rgb;
  dim: Rgb;
}

const TAU = Math.PI * 2;
/** Below this size the orb drops its finer detail (mesh dots, outer rings). */
const DETAIL_MIN_PX = 48;

function hexToRgb(value: string, fallback: Rgb): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m?.[1]) return fallback;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: Rgb): Rgb => hexToRgb(css.getPropertyValue(name), fallback);
  return {
    main: v('--orb-1', [46, 230, 212]),
    deep: v('--orb-2', [3, 28, 26]),
    hi: v('--orb-hi', [239, 255, 253]),
    lamp: v('--lamp-400', [245, 166, 35]),
    alarm: v('--alarm-500', [255, 97, 102]),
    dim: v('--ink-500', [143, 143, 143]),
  };
}

const rgba = ([r, g, b]: Rgb, a: number): string =>
  `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Evenly spread points on a unit sphere: the dotted "geodesic" core. */
function fibonacciSphere(n: number): Array<readonly [number, number, number]> {
  const pts: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    pts.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  return pts;
}
const DOTS = fibonacciSphere(170);

function toneFor(state: AssistantState, p: Palette): Rgb {
  if (state === 'AWAITING_CONFIRMATION') return p.lamp;
  if (state === 'ERROR') return p.alarm;
  if (state === 'SLEEP') return p.dim;
  return p.main;
}

/**
 * Draws the orb on a canvas each frame: glow, wavy outer rings, a ring of level bars, a bright
 * inner ring and a dotted sphere. `energy` follows the level with a fast attack and slow release,
 * so the orb jumps with speech or a beat and settles smoothly.
 */
export function createOrbPainter(ctx: CanvasRenderingContext2D, size: number) {
  let palette = readPalette();
  let energy = 0;
  let spin = 0;
  let lastT = 0;
  let frame = 0;
  const detailed = size >= DETAIL_MIN_PX;
  const R = size / 2;

  function glow(c: Rgb, e: number): void {
    const g = ctx.createRadialGradient(R, R, R * 0.25, R, R, R);
    g.addColorStop(0, rgba(c, 0.3 + e * 0.35));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  function outerRings(c: Rgb, e: number, t: number): void {
    ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const base = R * (0.76 + k * 0.07);
      const amp = R * (0.012 + e * 0.07) * (1 + k * 0.35);
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * TAU;
        const r =
          base +
          amp * (0.6 * Math.sin(5 * a + t * 1.3 + k) + 0.4 * Math.sin(9 * a - t * 2.1 + k * 2));
        const x = R + Math.cos(a) * r;
        const y = R + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(c, 0.22 + e * 0.3 - k * 0.05);
      ctx.stroke();
    }
  }

  function barColour(f: OrbFrame, c: Rgb, i: number, n: number, t: number): string {
    const a = (i / n) * TAU;
    if (f.state === 'THINKING') return rgba(c, 0.25 + 0.75 * Math.max(0, Math.cos(a - spin * 2)));
    if (f.state === 'ACTING' && f.steps.length) {
      const step = f.steps[Math.floor((i / n) * f.steps.length)];
      if (step === 'error') return rgba(palette.alarm, 0.9);
      if (step === 'done') return rgba(c, 0.95);
      if (step === 'running') return rgba(c, 0.45 + 0.4 * Math.sin(t * 6));
      return rgba(palette.dim, 0.35);
    }
    return rgba(c, 0.5 + energy * 0.45);
  }

  function bars(f: OrbFrame, c: Rgb, e: number, t: number): void {
    const n = detailed ? 72 : 28;
    const r0 = R * 0.53;
    ctx.lineWidth = Math.max(1, ((TAU * r0) / n) * 0.45);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const wobble = 0.55 + 0.45 * Math.sin(i * 1.9 + t * 4.2) * Math.sin(i * 0.43 - t * 1.7);
      const len = R * (0.05 + e * 0.22 * wobble + 0.012 * Math.sin(i + t * 2));
      ctx.beginPath();
      ctx.moveTo(R + Math.cos(a) * r0, R + Math.sin(a) * r0);
      ctx.lineTo(R + Math.cos(a) * (r0 + len), R + Math.sin(a) * (r0 + len));
      ctx.strokeStyle = barColour(f, c, i, n, t);
      ctx.stroke();
    }
  }

  function core(c: Rgb, e: number): void {
    const p = palette;
    const ring = R * 0.45 * (1 + e * 0.04);
    ctx.save();
    ctx.shadowColor = rgba(c, 0.9);
    ctx.shadowBlur = R * 0.25;
    ctx.lineWidth = Math.max(1, R * 0.03);
    ctx.strokeStyle = rgba(c, 0.95);
    ctx.beginPath();
    ctx.arc(R, R, ring, 0, TAU);
    ctx.stroke();
    ctx.restore();

    const rc = R * 0.36 * (1 + e * 0.1);
    const g = ctx.createRadialGradient(R - rc * 0.3, R - rc * 0.3, rc * 0.05, R, R, rc);
    g.addColorStop(0, rgba(p.hi, 0.95));
    g.addColorStop(0.55, rgba(c, 0.6));
    g.addColorStop(1, rgba(p.deep, 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(R, R, rc, 0, TAU);
    ctx.fill();
    if (!detailed) return;

    const tilt = 0.35;
    const [cy, sy] = [Math.cos(spin), Math.sin(spin)];
    const [cx, sx] = [Math.cos(tilt), Math.sin(tilt)];
    for (const [x, y, z] of DOTS) {
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      if (z2 < -0.15) continue;
      ctx.fillStyle = rgba(p.hi, 0.2 + 0.7 * z2 + e * 0.2);
      ctx.beginPath();
      ctx.arc(R + x1 * rc, R + y2 * rc, rc * 0.035 * (0.6 + 0.4 * z2), 0, TAU);
      ctx.fill();
    }
  }

  return function draw(f: OrbFrame, t: number, still: boolean): void {
    const dt = lastT ? Math.min(0.05, t - lastT) : 0.016;
    lastT = t;
    if (frame++ % 30 === 0) palette = readPalette(); // follows theme switches
    const asleep = f.state === 'SLEEP';
    const target = still || asleep ? 0 : Math.min(1, f.level * 4);
    energy += (target - energy) * (target > energy ? 0.45 : 0.08);
    if (!still) spin += dt * (f.state === 'THINKING' ? 1.6 : 0.35 + energy * 1.2);

    const c = toneFor(f.state, palette);
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = asleep ? 0.4 : 1;
    glow(c, energy);
    if (detailed) outerRings(c, energy, t);
    bars(f, c, energy, t);
    core(c, energy);
    ctx.globalAlpha = 1;
  };
}
