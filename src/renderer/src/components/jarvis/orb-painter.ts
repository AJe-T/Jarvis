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
type Vec = readonly [number, number, number];

interface Palette {
  main: Rgb;
  deep: Rgb;
  hi: Rgb;
  /** Second neon: the far side of the sphere, outer shells, filaments. */
  alt: Rgb;
  /** Third neon: sparks and HUD markers. */
  mark: Rgb;
  lamp: Rgb;
  alarm: Rgb;
  dim: Rgb;
  /** Additive glow only works on dark backgrounds; on light ones dots are painted normally. */
  light: boolean;
}

const TAU = Math.PI * 2;
/** From this size the orb wears its HUD (ticks, arcs, glyph ring) and throws sparks. */
const HUD_MIN_PX = 64;
const MIX_STEPS = 8;
const ALPHA_STEPS = 16;
const MAX_SPARKS = 90;
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
    alt: v('--orb-3', [122, 92, 255]),
    mark: v('--orb-4', [252, 238, 10]),
    lamp: v('--lamp-400', [252, 238, 10]),
    alarm: v('--alarm-500', [255, 77, 109]),
    dim: v('--ink-500', [125, 147, 168]),
    light: document.documentElement.dataset['theme'] === 'light',
  };
}

const rgba = ([r, g, b]: Rgb, a: number): string =>
  `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const lerp = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Evenly spread points on a unit sphere. */
function fibonacciSphere(n: number): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963;
    pts.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  return pts;
}

/** Cheap smooth 3D "noise": a few crossed sines, roughly -1..1. Enough to make the surface breathe. */
function wobble(x: number, y: number, z: number, t: number): number {
  return (
    (Math.sin(2.1 * x + 1.3 * t) * Math.cos(1.7 * y - 0.9 * t) +
      0.5 * Math.sin(3.3 * z + 2.1 * y + 1.7 * t) +
      0.35 * Math.sin(4.1 * x - 3.7 * z - 1.1 * t)) /
    1.85
  );
}

function toneFor(state: AssistantState, p: Palette): Rgb {
  if (state === 'AWAITING_CONFIRMATION') return p.lamp;
  if (state === 'ERROR') return p.alarm;
  if (state === 'SLEEP') return p.dim;
  return p.main;
}

function spinRate(state: AssistantState, energy: number): number {
  if (state === 'THINKING') return 1.6;
  if (state === 'LISTENING') return 0.8;
  return 0.25 + energy * 1.1;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
}

interface Detail {
  sphere: number;
  shells: number;
  shellPoints: number;
  ring: number;
}

function detailFor(size: number): Detail {
  if (size >= 300) return { sphere: 1500, shells: 3, shellPoints: 240, ring: 96 };
  if (size >= 150) return { sphere: 900, shells: 3, shellPoints: 160, ring: 72 };
  if (size >= HUD_MIN_PX) return { sphere: 420, shells: 2, shellPoints: 110, ring: 48 };
  return { sphere: 150, shells: 1, shellPoints: 60, ring: 28 };
}

/**
 * Draws Jarvis's orb each frame, back to front (Design-system.md §6.1): a halo; the HUD (tick ring,
 * segmented arcs, a turning glyph ring, markers); wavy particle shells; a breathing particle
 * sphere whose surface ripples with the level and shades from the accent to the second neon; a
 * hot core with swirling filaments; a ring of level dots (one segment per tool while acting); and
 * sparks thrown off when Jarvis speaks or thinks. `energy` follows the level with a fast attack
 * and slow release; at rest the orb breathes.
 */
export function createOrbPainter(ctx: CanvasRenderingContext2D, size: number) {
  let palette = readPalette();
  let energy = 0;
  let spin = 0;
  let lastT = 0;
  let frame = 0;
  let tone: Rgb = palette.main;
  let styles: string[] = [];
  const sparks: Spark[] = [];
  const d = detailFor(size);
  const hud = size >= HUD_MIN_PX;
  const R = size / 2;
  const sphereR = R * (hud ? 0.42 : 0.5);
  const points = fibonacciSphere(d.sphere);

  /** fillStyle strings for (colour mix, alpha) buckets, rebuilt when the palette or state tone changes. */
  function buildStyles(main: Rgb, alt: Rgb): void {
    styles = [];
    for (let m = 0; m < MIX_STEPS; m++) {
      const c = lerp(main, alt, m / (MIX_STEPS - 1));
      for (let a = 0; a < ALPHA_STEPS; a++) styles.push(rgba(c, (a + 1) / ALPHA_STEPS));
    }
  }
  const style = (mix: number, alpha: number): string =>
    styles[
      Math.min(MIX_STEPS - 1, Math.max(0, Math.round(mix * (MIX_STEPS - 1)))) * ALPHA_STEPS +
        Math.min(ALPHA_STEPS - 1, Math.max(0, Math.round(alpha * ALPHA_STEPS) - 1))
    ] ?? 'transparent';

  function halo(c: Rgb, alt: Rgb, e: number): void {
    const g = ctx.createRadialGradient(R, R, R * 0.1, R, R, R);
    g.addColorStop(0, rgba(c, 0.22 + e * 0.3));
    g.addColorStop(0.45, rgba(alt, 0.07 + e * 0.08));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  function ticks(c: Rgb, e: number): void {
    const n = size >= 200 ? 120 : 60;
    const r1 = R * 0.98;
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-spin * 0.1);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = R * (i % 10 === 0 ? 0.05 : 0.02);
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * (r1 - len), Math.sin(a) * (r1 - len));
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(c, 0.22 + e * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  function arcs(c: Rgb, e: number): void {
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(spin * 0.5);
    ctx.lineWidth = Math.max(1.2, R * 0.012);
    ctx.strokeStyle = rgba(c, 0.45 + e * 0.3);
    for (const [s, l] of ARCS) {
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.92, s, s + l);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A turning ring of small glyph marks, like a spell circle (the Doctor Strange reference). */
  function glyphs(alt: Rgb, e: number): void {
    const n = size >= 200 ? 48 : 24;
    const r = R * 0.86;
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-spin * 0.35);
    ctx.fillStyle = rgba(alt, 0.35 + e * 0.35);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.save();
      ctx.rotate(a);
      const w = R * (i % 3 === 0 ? 0.03 : 0.012);
      ctx.fillRect(r - w / 2, -R * 0.004, w, Math.max(1, R * 0.008) + (i % 4 === 0 ? R * 0.01 : 0));
      ctx.restore();
    }
    ctx.restore();
  }

  function markers(mark: Rgb): void {
    const s = R * 0.03;
    ctx.fillStyle = rgba(mark, 0.85);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU - Math.PI / 2 + spin * 0.05;
      const [x, y] = [R + Math.cos(a) * R * 0.95, R + Math.sin(a) * R * 0.95];
      const [nx, ny] = [-Math.cos(a), -Math.sin(a)];
      ctx.beginPath();
      ctx.moveTo(x + nx * s, y + ny * s);
      ctx.lineTo(x - ny * s * 0.7, y + nx * s * 0.7);
      ctx.lineTo(x + ny * s * 0.7, y - nx * s * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Wavy particle shells around the sphere, each tilted and turning on its own axis. */
  function shells(e: number, t: number): void {
    for (let k = 0; k < d.shells; k++) {
      const base = R * (0.6 + k * 0.085);
      const tilt = 0.2 + k * 0.22 + Math.sin(t * 0.2 + k) * 0.12;
      const turn = spin * (k % 2 ? -0.6 : 0.45) + k * 1.3;
      const amp = R * (0.035 + e * 0.1) * (1 + k * 0.35);
      const [ct, st] = [Math.cos(tilt), Math.sin(tilt)];
      for (let i = 0; i < d.shellPoints; i++) {
        const a = (i / d.shellPoints) * TAU;
        const r = base + amp * wobble(Math.cos(a) * 2, Math.sin(a) * 2, k, t * (1 + k * 0.3));
        const x = Math.cos(a + turn) * r;
        const y0 = Math.sin(a + turn) * r;
        const y = y0 * ct;
        const z = y0 * st;
        const depth = 0.5 + (0.5 * z) / r;
        const px = Math.max(1, R * 0.008 * (0.6 + depth));
        ctx.fillStyle = style(0.35 + k * 0.25, (0.18 + 0.45 * depth) * (0.6 + e * 0.6));
        ctx.fillRect(R + x - px / 2, R + y - px / 2, px, px);
      }
    }
  }

  /** The breathing particle sphere: rotated, rippled by the level, shaded by depth and side. */
  function sphere(e: number, t: number): void {
    const amp = 0.05 + e * 0.24;
    const tilt = 0.32 + Math.sin(t * 0.15) * 0.12;
    const [cy, sy] = [Math.cos(spin), Math.sin(spin)];
    const [cx, sx] = [Math.cos(tilt), Math.sin(tilt)];
    const dot = Math.max(1, sphereR * 0.022);
    for (const [x, y, z] of points) {
      const k = 1 + amp * wobble(x * 1.6, y * 1.6, z * 1.6, t * 1.4);
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      const depth = (z2 + 1) / 2;
      const px = dot * (0.45 + 0.9 * depth);
      ctx.fillStyle = style((x1 + 1) / 2, 0.12 + 0.8 * depth * depth + e * 0.15);
      ctx.fillRect(R + x1 * sphereR * k - px / 2, R + y2 * sphereR * k - px / 2, px, px);
    }
  }

  function core(c: Rgb, alt: Rgb, e: number, t: number): void {
    const p = palette;
    const rc = sphereR * (0.42 + e * 0.12);
    const g = ctx.createRadialGradient(R, R, 0, R, R, rc * 1.6);
    g.addColorStop(0, rgba(p.hi, 0.85 + e * 0.15));
    g.addColorStop(0.25, rgba(c, 0.55 + e * 0.3));
    g.addColorStop(0.7, rgba(alt, 0.12));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(R, R, rc * 1.6, 0, TAU);
    ctx.fill();
    if (size < HUD_MIN_PX) return;
    // Swirling filaments in the core: Lissajous ribbons drawn as dotted strands.
    const strands = 4;
    for (let s = 0; s < strands; s++) {
      const ph = t * (0.6 + s * 0.17) + s * 1.9;
      for (let i = 0; i < 70; i++) {
        const u = (i / 70) * TAU;
        const x = Math.sin(2 * u + ph) * Math.cos(u * 0.5 + spin);
        const y = Math.sin(3 * u - ph * 0.7) * 0.8;
        const px = Math.max(1, R * 0.007);
        ctx.fillStyle = style(s / strands, 0.25 + e * 0.4);
        ctx.fillRect(R + x * rc * 1.15 - px / 2, R + y * rc * 1.15 - px / 2, px, px);
      }
    }
  }

  function ringColour(f: OrbFrame, c: Rgb, i: number, n: number, t: number): string {
    const a = (i / n) * TAU;
    if (f.state === 'THINKING') return rgba(c, 0.15 + 0.85 * Math.max(0, Math.cos(a - spin * 2.2)));
    if (f.state === 'ACTING' && f.steps.length) {
      const step = f.steps[Math.floor((i / n) * f.steps.length)];
      if (step === 'error') return rgba(palette.alarm, 0.95);
      if (step === 'done') return rgba(c, 0.95);
      if (step === 'running') return rgba(c, 0.45 + 0.45 * Math.sin(t * 6));
      return rgba(palette.dim, 0.35);
    }
    return rgba(c, 0.4 + energy * 0.55);
  }

  /** A ring of dots that jump outward with the level (the old bar ring, in particles). */
  function levelRing(f: OrbFrame, c: Rgb, e: number, t: number): void {
    const n = d.ring;
    const r0 = R * (hud ? 0.53 : 0.64);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const jump =
        e * R * 0.12 * (0.55 + 0.45 * Math.sin(i * 1.9 + t * 4.2) * Math.sin(i * 0.43 - t * 1.7));
      ctx.fillStyle = ringColour(f, c, i, n, t);
      const dots = hud ? 3 : 1;
      for (let k = 0; k < dots; k++) {
        const r = r0 + (jump * (k + 1)) / dots;
        const px = Math.max(1.2, R * 0.012) * (1 - k * 0.2);
        ctx.fillRect(R + Math.cos(a) * r - px / 2, R + Math.sin(a) * r - px / 2, px, px);
      }
    }
  }

  /** Sparks thrown off the surface while Jarvis speaks or thinks; they curl and fade. */
  function sparksStep(f: OrbFrame, dt: number, mark: Rgb, c: Rgb): void {
    const rate = f.state === 'THINKING' ? 40 : f.state === 'SLEEP' ? 0 : energy * 120;
    let spawn = rate * dt + (Math.random() < (rate * dt) % 1 ? 1 : 0);
    while (spawn-- >= 1 && sparks.length < MAX_SPARKS) {
      const a = Math.random() * TAU;
      const speed = R * (0.25 + Math.random() * 0.5 + energy);
      sparks.push({
        x: Math.cos(a) * sphereR,
        y: Math.sin(a) * sphereR,
        vx: Math.cos(a + 0.5) * speed,
        vy: Math.sin(a + 0.5) * speed,
        life: 0,
        ttl: 0.5 + Math.random() * 0.9,
      });
    }
    ctx.lineWidth = Math.max(1, R * 0.008);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      if (!s) continue;
      s.life += dt;
      if (s.life >= s.ttl) {
        sparks.splice(i, 1);
        continue;
      }
      // Curl: rotate the velocity a little each frame, like embers in a vortex.
      const [vx, vy] = [
        s.vx * Math.cos(dt * 1.4) - s.vy * Math.sin(dt * 1.4),
        s.vx * Math.sin(dt * 1.4) + s.vy * Math.cos(dt * 1.4),
      ];
      s.vx = vx * (1 - dt * 0.6);
      s.vy = vy * (1 - dt * 0.6);
      const [x0, y0] = [s.x, s.y];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const fade = 1 - s.life / s.ttl;
      ctx.strokeStyle = rgba(
        s.life < s.ttl * 0.3 ? palette.hi : Math.random() < 0.5 ? mark : c,
        fade * 0.9,
      );
      ctx.beginPath();
      ctx.moveTo(R + x0, R + y0);
      ctx.lineTo(R + s.x, R + s.y);
      ctx.stroke();
    }
  }

  return function draw(f: OrbFrame, t: number, still: boolean): void {
    const dt = lastT ? Math.min(0.05, t - lastT) : 0.016;
    lastT = t;
    if (frame++ % 30 === 0) palette = readPalette(); // follows theme and accent switches
    const asleep = f.state === 'SLEEP';
    const breathe = still || asleep ? 0 : 0.06 + 0.04 * Math.sin(t * 1.3);
    const target = still || asleep ? 0 : Math.max(breathe, Math.min(1, f.level * 4));
    energy += (target - energy) * (target > energy ? 0.45 : 0.08);
    if (!still) spin += dt * spinRate(f.state, energy);

    const c = toneFor(f.state, palette);
    const alt = f.state === 'ERROR' ? palette.alarm : palette.alt;
    if (c !== tone || frame % 30 === 1 || styles.length === 0) {
      tone = c;
      buildStyles(c, alt);
    }
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.globalAlpha = asleep ? 0.4 : 1;
    if (!still && f.state === 'ERROR') ctx.translate((Math.random() - 0.5) * R * 0.05, 0);
    halo(c, alt, energy);
    if (hud) {
      ticks(c, energy);
      arcs(c, energy);
      glyphs(alt, energy);
    }
    ctx.globalCompositeOperation = palette.light ? 'source-over' : 'lighter';
    shells(energy, t);
    sphere(energy, t);
    core(c, alt, energy, t);
    levelRing(f, c, energy, t);
    if (hud && !still) sparksStep(f, dt, palette.mark, c);
    ctx.globalCompositeOperation = 'source-over';
    if (hud) markers(palette.mark);
    ctx.restore();
  };
}
