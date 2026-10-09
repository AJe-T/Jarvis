import { TAU, lerp, rgba, type Env, type Rgb } from '../orb-kit';

/** HUD pieces shared by several orb styles. All draw around (R, R). */

export function halo(env: Env, strength = 1): void {
  const { ctx, R, c, alt, e, size } = env;
  const g = ctx.createRadialGradient(R, R, R * 0.1, R, R, R);
  g.addColorStop(0, rgba(c, (0.22 + e * 0.3) * strength));
  g.addColorStop(0.45, rgba(alt, (0.07 + e * 0.08) * strength));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

export function ticks(env: Env, radius = 0.98, speed = -0.1): void {
  const { ctx, R, c, e, size, spin } = env;
  const n = size >= 200 ? 120 : 60;
  const r1 = R * radius;
  ctx.save();
  ctx.translate(R, R);
  ctx.rotate(spin * speed);
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

const ARCS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.95],
  [1.2, 0.32],
  [1.72, 1.15],
  [3.1, 0.22],
  [3.52, 1.25],
  [5.0, 0.85],
];

export function segmentedArcs(env: Env, radius = 0.92, speed = 0.5, colour?: Rgb): void {
  const { ctx, R, c, e, spin } = env;
  ctx.save();
  ctx.translate(R, R);
  ctx.rotate(spin * speed);
  ctx.lineWidth = Math.max(1.2, R * 0.014);
  ctx.strokeStyle = rgba(colour ?? c, 0.5 + e * 0.35);
  for (const [s, l] of ARCS) {
    ctx.beginPath();
    ctx.arc(0, 0, R * radius, s, s + l);
    ctx.stroke();
  }
  ctx.restore();
}

/** A turning ring of small glyph marks, like a spell circle. */
export function glyphRing(env: Env, radius = 0.86, speed = -0.35, colour?: Rgb): void {
  const { ctx, R, alt, e, size, spin } = env;
  const n = size >= 200 ? 48 : 24;
  const r = R * radius;
  ctx.save();
  ctx.translate(R, R);
  ctx.rotate(spin * speed);
  ctx.fillStyle = rgba(colour ?? alt, 0.35 + e * 0.35);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.rotate((i / n) * TAU);
    const w = R * (i % 3 === 0 ? 0.03 : 0.012);
    ctx.fillRect(r - w / 2, -R * 0.004, w, Math.max(1, R * 0.008) + (i % 4 === 0 ? R * 0.01 : 0));
    ctx.restore();
  }
  ctx.restore();
}

/** Four inward-pointing triangles in the third neon. */
export function markers(env: Env, radius = 0.95): void {
  const { ctx, R, p, spin } = env;
  const s = R * 0.03;
  ctx.fillStyle = rgba(p.mark, 0.85);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU - Math.PI / 2 + spin * 0.05;
    const [x, y] = [R + Math.cos(a) * R * radius, R + Math.sin(a) * R * radius];
    const [nx, ny] = [-Math.cos(a), -Math.sin(a)];
    ctx.beginPath();
    ctx.moveTo(x + nx * s, y + ny * s);
    ctx.lineTo(x - ny * s * 0.7, y + nx * s * 0.7);
    ctx.lineTo(x + ny * s * 0.7, y - nx * s * 0.7);
    ctx.closePath();
    ctx.fill();
  }
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
}

/** Sparks thrown off a circle while Jarvis speaks or thinks; they curl like embers and fade. */
export function createSparks(max = 90) {
  const sparks: Spark[] = [];
  return function step(env: Env, from: number, colours?: readonly Rgb[]): void {
    const { ctx, R, f, dt, e, p, c } = env;
    if (env.still) return;
    const rate = f.state === 'THINKING' ? 40 : f.state === 'SLEEP' ? 0 : e * 120;
    let spawn = rate * dt + (Math.random() < (rate * dt) % 1 ? 1 : 0);
    while (spawn-- >= 1 && sparks.length < max) {
      const a = Math.random() * TAU;
      const speed = R * (0.25 + Math.random() * 0.5 + e);
      sparks.push({
        x: Math.cos(a) * from,
        y: Math.sin(a) * from,
        vx: Math.cos(a + 0.5) * speed,
        vy: Math.sin(a + 0.5) * speed,
        life: 0,
        ttl: 0.5 + Math.random() * 0.9,
      });
    }
    const pick = colours ?? [p.mark, c];
    ctx.lineWidth = Math.max(1, R * 0.008);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      if (!s) continue;
      s.life += dt;
      if (s.life >= s.ttl) {
        sparks.splice(i, 1);
        continue;
      }
      const [cos, sin] = [Math.cos(dt * 1.4), Math.sin(dt * 1.4)];
      const [vx, vy] = [s.vx * cos - s.vy * sin, s.vx * sin + s.vy * cos];
      s.vx = vx * (1 - dt * 0.6);
      s.vy = vy * (1 - dt * 0.6);
      const [x0, y0] = [s.x, s.y];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const fade = 1 - s.life / s.ttl;
      const col = s.life < s.ttl * 0.3 ? p.hi : (pick[i % pick.length] ?? c);
      ctx.strokeStyle = rgba(col, fade * 0.9);
      ctx.beginPath();
      ctx.moveTo(R + x0, R + y0);
      ctx.lineTo(R + s.x, R + s.y);
      ctx.stroke();
    }
  };
}

const MIX_STEPS = 8;
const ALPHA_STEPS = 16;

/**
 * fillStyle strings bucketed by (colour mix between two colours, alpha), so styles that paint
 * thousands of dots a frame don't build thousands of strings.
 */
export function createDotStyles() {
  let styles: string[] = [];
  let key = '';
  return {
    use(a: Rgb, b: Rgb): void {
      const k = `${a.join()}|${b.join()}`;
      if (k === key) return;
      key = k;
      styles = [];
      for (let m = 0; m < MIX_STEPS; m++) {
        const c = lerp(a, b, m / (MIX_STEPS - 1));
        for (let al = 0; al < ALPHA_STEPS; al++) styles.push(rgba(c, (al + 1) / ALPHA_STEPS));
      }
    },
    at(mix: number, alpha: number): string {
      const m = Math.min(MIX_STEPS - 1, Math.max(0, Math.round(mix * (MIX_STEPS - 1))));
      const al = Math.min(ALPHA_STEPS - 1, Math.max(0, Math.round(alpha * ALPHA_STEPS) - 1));
      return styles[m * ALPHA_STEPS + al] ?? 'transparent';
    },
  };
}
