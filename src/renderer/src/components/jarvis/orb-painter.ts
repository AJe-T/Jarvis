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
  /** Second neon: the dashed counter-ring, sweep tail and plasma filaments. */
  alt: Rgb;
  /** Third neon: the four HUD markers. */
  mark: Rgb;
  lamp: Rgb;
  alarm: Rgb;
  dim: Rgb;
}

const TAU = Math.PI * 2;
/** Below this size the orb drops its finer detail (plasma, sphere dots). */
const DETAIL_MIN_PX = 48;
/** From this size the orb wears its HUD: tick ring, segmented arcs, radar sweep, markers. */
const HUD_MIN_PX = 64;
/** Segmented arc ring: [start angle, length] in radians, fixed so the HUD reads as designed. */
const ARCS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.95],
  [1.2, 0.32],
  [1.72, 1.15],
  [3.1, 0.22],
  [3.52, 1.25],
  [5.0, 0.85],
];

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
    main: v('--orb-1', [0, 240, 255]),
    deep: v('--orb-2', [0, 20, 28]),
    hi: v('--orb-hi', [234, 253, 255]),
    alt: v('--orb-3', [255, 43, 214]),
    mark: v('--orb-4', [252, 238, 10]),
    lamp: v('--lamp-400', [252, 238, 10]),
    alarm: v('--alarm-500', [255, 77, 109]),
    dim: v('--ink-500', [125, 147, 168]),
  };
}

const rgba = ([r, g, b]: Rgb, a: number): string =>
  `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Evenly spread points on a unit sphere: the dotted shell of the core. */
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
const DOTS = fibonacciSphere(140);

function toneFor(state: AssistantState, p: Palette): Rgb {
  if (state === 'AWAITING_CONFIRMATION') return p.lamp;
  if (state === 'ERROR') return p.alarm;
  if (state === 'SLEEP') return p.dim;
  return p.main;
}

function spinRate(state: AssistantState, energy: number): number {
  if (state === 'THINKING') return 1.8;
  if (state === 'LISTENING') return 0.9;
  return 0.35 + energy * 1.2;
}

/**
 * Draws the orb on a canvas each frame, back to front: a halo, the HUD (tick ring, radar sweep,
 * segmented arcs, a dashed counter-ring, markers), a ring of level bars, and a plasma core (bright
 * ring, glowing sphere, swirling filaments, dotted shell). `energy` follows the level with a fast
 * attack and slow release, so the orb jumps with speech or a beat and settles smoothly; at rest it
 * breathes.
 */
export function createOrbPainter(ctx: CanvasRenderingContext2D, size: number) {
  let palette = readPalette();
  let energy = 0;
  let spin = 0;
  let lastT = 0;
  let frame = 0;
  const detailed = size >= DETAIL_MIN_PX;
  const hud = size >= HUD_MIN_PX;
  const R = size / 2;
  const coreR = R * (hud ? 0.4 : 0.36);
  const barR = R * (hud ? 0.58 : 0.53);

  function halo(c: Rgb, e: number): void {
    const g = ctx.createRadialGradient(R, R, R * 0.15, R, R, R);
    g.addColorStop(0, rgba(c, 0.24 + e * 0.35));
    g.addColorStop(0.6, rgba(c, 0.06 + e * 0.1));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  function ticks(c: Rgb, e: number): void {
    const n = size >= 200 ? 120 : 60;
    const r1 = R * 0.97;
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-spin * 0.12);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = R * (i % 10 === 0 ? 0.055 : 0.022);
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * (r1 - len), Math.sin(a) * (r1 - len));
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(c, 0.3 + e * 0.25);
    ctx.stroke();
    ctx.restore();
  }

  function sweep(c: Rgb, alt: Rgb): void {
    const a0 = spin * 1.4;
    const g = ctx.createConicGradient(a0, R, R);
    g.addColorStop(0, rgba(alt, 0));
    g.addColorStop(0.1, rgba(alt, 0.25));
    g.addColorStop(0.14, rgba(c, 0.7));
    g.addColorStop(0.1401, rgba(c, 0));
    g.addColorStop(1, rgba(c, 0));
    ctx.save();
    ctx.lineWidth = R * 0.07;
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.arc(R, R, R * 0.85, a0, a0 + TAU * 0.14);
    ctx.stroke();
    ctx.restore();
  }

  function arcs(c: Rgb, alt: Rgb, e: number): void {
    ctx.save();
    ctx.translate(R, R);
    ctx.lineCap = 'butt';
    ctx.rotate(spin * 0.6);
    ctx.lineWidth = Math.max(1.5, R * 0.018);
    ctx.strokeStyle = rgba(c, 0.7 + e * 0.25);
    for (const [s, l] of ARCS) {
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.885, s, s + l);
      ctx.stroke();
    }
    ctx.rotate(-spin * 1.5);
    ctx.setLineDash([R * 0.02, R * 0.045]);
    ctx.lineWidth = Math.max(1, R * 0.01);
    ctx.strokeStyle = rgba(alt, 0.55 + e * 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.8, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Four inward-pointing triangles and the bright nodes riding the rings. */
  function markers(c: Rgb, alt: Rgb, mark: Rgb): void {
    const s = R * 0.035;
    ctx.fillStyle = rgba(mark, 0.85);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU - Math.PI / 2;
      const [x, y] = [R + Math.cos(a) * R * 0.925, R + Math.sin(a) * R * 0.925];
      const [nx, ny] = [-Math.cos(a), -Math.sin(a)];
      ctx.beginPath();
      ctx.moveTo(x + nx * s, y + ny * s);
      ctx.lineTo(x - ny * s * 0.7, y + nx * s * 0.7);
      ctx.lineTo(x + ny * s * 0.7, y - nx * s * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowBlur = R * 0.06;
    for (const [rr, a, col] of [
      [0.885, spin * 0.6 + 0.95, c],
      [0.885, spin * 0.6 + 4.77, c],
      [0.8, -spin * 0.9 + 2.2, alt],
    ] as const) {
      ctx.shadowColor = rgba(col, 1);
      ctx.fillStyle = rgba(col, 1);
      ctx.beginPath();
      ctx.arc(R + Math.cos(a) * R * rr, R + Math.sin(a) * R * rr, R * 0.014 + 1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function barColour(f: OrbFrame, c: Rgb, i: number, n: number, t: number): string {
    const a = (i / n) * TAU;
    if (f.state === 'THINKING') return rgba(c, 0.2 + 0.8 * Math.max(0, Math.cos(a - spin * 2)));
    if (f.state === 'ACTING' && f.steps.length) {
      const step = f.steps[Math.floor((i / n) * f.steps.length)];
      if (step === 'error') return rgba(palette.alarm, 0.9);
      if (step === 'done') return rgba(c, 0.95);
      if (step === 'running') return rgba(c, 0.45 + 0.4 * Math.sin(t * 6));
      return rgba(palette.dim, 0.35);
    }
    return rgba(c, 0.45 + energy * 0.5);
  }

  function bars(f: OrbFrame, c: Rgb, e: number, t: number): void {
    const n = detailed ? 90 : 28;
    ctx.lineWidth = Math.max(1, ((TAU * barR) / n) * 0.42);
    ctx.lineCap = 'butt';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const wobble = 0.55 + 0.45 * Math.sin(i * 1.9 + t * 4.2) * Math.sin(i * 0.43 - t * 1.7);
      const len = R * (0.035 + e * 0.2 * wobble + 0.01 * Math.sin(i + t * 2));
      ctx.beginPath();
      ctx.moveTo(R + Math.cos(a) * barR, R + Math.sin(a) * barR);
      ctx.lineTo(R + Math.cos(a) * (barR + len), R + Math.sin(a) * (barR + len));
      ctx.strokeStyle = barColour(f, c, i, n, t);
      ctx.stroke();
    }
  }

  function plasma(c: Rgb, alt: Rgb, rc: number, e: number, t: number): void {
    const p = palette;
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, rc, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(0.8, R * 0.006);
    for (let k = 0; k < 5; k++) {
      const phase = t * (0.55 + k * 0.21) + k * 1.7;
      const turn = spin * 0.5 * (k % 2 ? 1 : -1);
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * TAU;
        const rr = Math.min(
          rc * 0.97,
          rc *
            (0.2 +
              0.62 *
                Math.abs(Math.sin(2 * a + phase)) *
                (0.7 + 0.3 * Math.sin(3 * a - phase * 1.3)) *
                (0.8 + e * 0.45)),
        );
        const x = R + Math.cos(a + turn) * rr;
        const y = R + Math.sin(a + turn) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(k % 2 ? alt : p.hi, 0.16 + e * 0.3);
      ctx.stroke();
    }

    const tilt = 0.35;
    const [cy, sy] = [Math.cos(spin), Math.sin(spin)];
    const [cx, sx] = [Math.cos(tilt), Math.sin(tilt)];
    for (const [x, y, z] of DOTS) {
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      if (z2 < -0.1) continue;
      ctx.fillStyle = rgba(p.hi, 0.12 + 0.5 * z2 + e * 0.2);
      ctx.beginPath();
      ctx.arc(R + x1 * rc * 0.96, R + y2 * rc * 0.96, rc * 0.026 * (0.6 + 0.4 * z2), 0, TAU);
      ctx.fill();
    }

    const hot = ctx.createRadialGradient(R, R, 0, R, R, rc * 0.75);
    hot.addColorStop(0, rgba(p.hi, 0.75 + e * 0.25));
    hot.addColorStop(0.3, rgba(c, 0.35 + e * 0.3));
    hot.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = hot;
    ctx.fillRect(R - rc, R - rc, rc * 2, rc * 2);
    ctx.restore();
  }

  function core(c: Rgb, alt: Rgb, e: number, t: number): void {
    const p = palette;
    const ring = R * (hud ? 0.5 : 0.45) * (1 + e * 0.04);
    ctx.save();
    ctx.shadowColor = rgba(c, 0.95);
    ctx.shadowBlur = R * 0.22;
    ctx.lineWidth = Math.max(1, R * 0.026);
    ctx.strokeStyle = rgba(c, 0.95);
    ctx.beginPath();
    ctx.arc(R, R, ring, 0, TAU);
    ctx.stroke();
    ctx.restore();
    if (hud) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(c, 0.25);
      ctx.beginPath();
      ctx.arc(R, R, R * 0.535, 0, TAU);
      ctx.stroke();
    }

    const rc = coreR * (1 + e * 0.08);
    const g = ctx.createRadialGradient(R - rc * 0.25, R - rc * 0.3, rc * 0.05, R, R, rc);
    g.addColorStop(0, rgba(p.hi, 0.9));
    g.addColorStop(0.45, rgba(c, 0.55));
    g.addColorStop(1, rgba(p.deep, 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(R, R, rc, 0, TAU);
    ctx.fill();
    if (detailed) plasma(c, alt, rc, e, t);
  }

  return function draw(f: OrbFrame, t: number, still: boolean): void {
    const dt = lastT ? Math.min(0.05, t - lastT) : 0.016;
    lastT = t;
    if (frame++ % 30 === 0) palette = readPalette(); // follows theme switches
    const asleep = f.state === 'SLEEP';
    const breathe = still || asleep ? 0 : 0.05 + 0.03 * Math.sin(t * 1.3);
    const target = still || asleep ? 0 : Math.max(breathe, Math.min(1, f.level * 4));
    energy += (target - energy) * (target > energy ? 0.45 : 0.08);
    if (!still) spin += dt * spinRate(f.state, energy);

    const c = toneFor(f.state, palette);
    const alt = f.state === 'ERROR' ? palette.alarm : palette.alt;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.globalAlpha = asleep ? 0.4 : 1;
    // ERROR: the whole orb jitters sideways (a glitch), never under reduced motion.
    if (!still && f.state === 'ERROR') ctx.translate((Math.random() - 0.5) * R * 0.05, 0);
    halo(c, energy);
    if (hud) {
      ticks(c, energy);
      sweep(c, alt);
      arcs(c, alt, energy);
    }
    bars(f, c, energy, t);
    core(c, alt, energy, t);
    if (hud) markers(c, alt, palette.mark);
    ctx.restore();
  };
}
