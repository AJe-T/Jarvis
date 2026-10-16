import {
  TAU,
  additive,
  glow,
  lerp,
  project,
  rgba,
  type Env,
  type OrbStyle,
  type Rgb,
  type Vec,
} from '../orb-kit';
import { halo, ticks } from './parts';

/** v2.9 styles: aurora, voice waves, wormhole, tesseract, iris, firefly swarm and crystal. */

function rim(env: Env, r: number, alpha: number): void {
  const { ctx, R, c } = env;
  ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.strokeStyle = rgba(c, alpha);
  ctx.beginPath();
  ctx.arc(R, R, r, 0, TAU);
  ctx.stroke();
}

/** Aurora: curtains of light ripple inside a dark sphere; they rise and brighten as Jarvis speaks. */
export function aurora(size: number): OrbStyle {
  const steps = size >= 150 ? 64 : 28;
  return {
    draw(env) {
      const { ctx, R, e, t, c, alt, p } = env;
      const r = R * 0.78;
      glow(ctx, R, R, R, c, 0.1 + e * 0.15);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = rgba(p.deep, p.light ? 0.15 : 0.65);
      ctx.fillRect(R - r, R - r, r * 2, r * 2);
      ctx.globalCompositeOperation = additive(env);
      for (let i = 0; i < 5; i++) {
        const base = R + r * (-0.2 + i * 0.13);
        const amp = r * (0.07 + e * 0.16);
        const h = r * (0.32 + e * 0.3 + 0.08 * Math.sin(t * 0.7 + i));
        const col = lerp(c, alt, i / 4);
        const yAt = (x: number): number =>
          base +
          Math.sin((x * 3.1) / r + t * (0.5 + i * 0.13) + i * 1.7) * amp +
          Math.sin((x * 7.3) / r - t * 1.1 + i) * amp * 0.35;
        const g = ctx.createLinearGradient(0, base - h - amp, 0, base + amp);
        g.addColorStop(0, rgba(col, 0));
        g.addColorStop(0.8, rgba(col, 0.28 + e * 0.35));
        g.addColorStop(1, rgba(p.hi, 0.05));
        ctx.fillStyle = g;
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) {
          const x = R - r + (2 * r * k) / steps;
          if (k === 0) ctx.moveTo(x, yAt(x - R) - h);
          else ctx.lineTo(x, yAt(x - R) - h);
        }
        for (let k = steps; k >= 0; k--) {
          const x = R - r + (2 * r * k) / steps;
          ctx.lineTo(x, yAt(x - R));
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(lerp(col, p.hi, 0.4), 0.55 + e * 0.4);
        ctx.lineWidth = Math.max(1, R * 0.01);
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) {
          const x = R - r + (2 * r * k) / steps;
          if (k === 0) ctx.moveTo(x, yAt(x - R));
          else ctx.lineTo(x, yAt(x - R));
        }
        ctx.stroke();
      }
      ctx.restore();
      rim(env, r, 0.5);
    },
  };
}

/** Voice waves: layered glowing waves across the orb, tapered at the ends, tall when speaking. */
export function waves(size: number): OrbStyle {
  const steps = size >= 150 ? 120 : 48;
  return {
    draw(env) {
      const { ctx, R, e, t, c, alt, p } = env;
      const r = R * 0.82;
      halo(env, 0.5);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      const layers: Array<[Rgb, number, number, number]> = [
        [alt, 1.3, 0.9, -1.4],
        [p.mark, 2.1, 0.55, 2.2],
        [c, 1.7, 1, 3.1],
      ];
      for (const [col, freq, scale, speed] of layers) {
        const amp = r * (0.1 + e * 0.6) * scale;
        const pts: Array<[number, number]> = [];
        for (let k = 0; k <= steps; k++) {
          const u = (k / steps) * 2 - 1;
          const taper = (1 - u * u) ** 2;
          pts.push([R + u * r, R + Math.sin(u * freq * Math.PI * 2 + t * speed) * amp * taper]);
        }
        const trace = (): void => {
          ctx.beginPath();
          pts.forEach(([x, y], k) => (k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        };
        // Filled down to the centre line, but only the wave itself is stroked.
        trace();
        ctx.lineTo(R + r, R);
        ctx.lineTo(R - r, R);
        ctx.closePath();
        ctx.fillStyle = rgba(col, 0.16 + e * 0.2);
        ctx.fill();
        trace();
        ctx.strokeStyle = rgba(lerp(col, p.hi, 0.3), 0.85);
        ctx.lineWidth = Math.max(1, R * 0.014);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = rgba(c, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(R - r, R);
      ctx.lineTo(R + r, R);
      ctx.stroke();
    },
  };
}

/** Wormhole: rings rush into a bright throat while the tunnel twists; faster with the level. */
export function wormhole(size: number): OrbStyle {
  const rings = size >= 150 ? 18 : 10;
  let travel = 0;
  return {
    draw(env) {
      const { ctx, R, e, dt, c, alt, p, spin, still } = env;
      if (!still) travel += dt * (0.12 + e * 0.7);
      glow(ctx, R, R, R, alt, 0.12 + e * 0.15);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      for (let i = 0; i < rings; i++) {
        const z = (i / rings + travel) % 1; // 0 = deep in the throat, 1 = at the mouth
        const rr = R * 0.9 * z * z;
        const twist = spin * 1.5 + z * 4;
        const off = R * 0.07 * (1 - z);
        ctx.lineWidth = Math.max(0.6, R * 0.02 * z);
        ctx.strokeStyle = rgba(lerp(alt, c, z), Math.min(1, z * (1 - z) * 4) * (0.6 + e * 0.4));
        ctx.beginPath();
        ctx.arc(R + Math.cos(twist) * off, R + Math.sin(twist) * off, Math.max(0.5, rr), 0, TAU);
        ctx.stroke();
      }
      const spokes = 16;
      ctx.lineWidth = Math.max(0.6, R * 0.006);
      for (let k = 0; k < spokes; k++) {
        const a = (k / spokes) * TAU + spin * 0.6;
        ctx.strokeStyle = rgba(c, 0.12 + e * 0.15);
        ctx.beginPath();
        ctx.moveTo(R + Math.cos(a) * R * 0.08, R + Math.sin(a) * R * 0.08);
        ctx.lineTo(R + Math.cos(a + 0.5) * R * 0.9, R + Math.sin(a + 0.5) * R * 0.9);
        ctx.stroke();
      }
      ctx.restore();
      glow(ctx, R, R, R * 0.22 * (1 + e), c, 0.9);
      glow(ctx, R, R, R * 0.07, p.hi, 1);
    },
  };
}

/** The 16 corners of a 4D cube and its 32 edges (corners that differ in one coordinate). */
const HYPER = Array.from({ length: 16 }, (_, i) =>
  [0, 1, 2, 3].map((b) => ((i >> b) & 1 ? 1 : -1)),
);
const HYPER_EDGES: Array<[number, number]> = [];
for (let i = 0; i < 16; i++)
  for (let b = 0; b < 4; b++) if (!((i >> b) & 1)) HYPER_EDGES.push([i, i | (1 << b)]);

/** Tesseract: a 4D cube turning through itself, projected to 3D and then to the screen. */
export function tesseract(): OrbStyle {
  return {
    draw(env) {
      const { ctx, R, e, spin, c, alt, p, t } = env;
      halo(env, 0.6);
      const [a, b] = [spin * 0.7, spin * 0.45 + 0.6];
      const pts = HYPER.map(([x = 0, y = 0, z = 0, w = 0]) => {
        const x1 = x * Math.cos(a) - w * Math.sin(a);
        const w1 = x * Math.sin(a) + w * Math.cos(a);
        const z1 = z * Math.cos(b) - w1 * Math.sin(b);
        const w2 = z * Math.sin(b) + w1 * Math.cos(b);
        const k = 1 / (2.6 - w2);
        return project([x1 * k, y * k, z1 * k] as Vec, spin * 0.3, 0.45 + Math.sin(t * 0.3) * 0.1);
      });
      const s = R * 0.6 * (1 + e * 0.2);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      ctx.lineWidth = Math.max(1, R * 0.014);
      for (const [i, j] of HYPER_EDGES) {
        const [u, v] = [pts[i], pts[j]];
        if (!u || !v) continue;
        const depth = (u[2] + v[2] + 1.2) / 2.4;
        ctx.strokeStyle = rgba(lerp(alt, c, depth), 0.25 + depth * 0.65);
        ctx.beginPath();
        ctx.moveTo(R + u[0] * s, R + u[1] * s);
        ctx.lineTo(R + v[0] * s, R + v[1] * s);
        ctx.stroke();
      }
      for (const v of pts) glow(ctx, R + v[0] * s, R + v[1] * s, R * 0.05, p.hi, 0.6 + e * 0.4);
      ctx.restore();
      glow(ctx, R, R, R * 0.2 * (1 + e), c, 0.35);
    },
  };
}

/** Iris: a camera aperture; the blades twist open as Jarvis listens or speaks, a light burns inside. */
export function iris(): OrbStyle {
  const blades = 9;
  return {
    draw(env) {
      const { ctx, R, e, spin, c, alt, p, f, hud } = env;
      const outer = R * 0.82;
      const open = f.state === 'LISTENING' ? 0.55 : 0.2 + e * 0.6;
      const ap = outer * Math.min(0.85, open);
      const rot = spin * 0.4 + open * 1.4;
      glow(ctx, R, R, R, c, 0.1 + e * 0.2);
      glow(ctx, R, R, ap * 1.1, c, 0.85);
      glow(ctx, R, R, ap * 0.35, p.hi, 0.9);
      const corners = Array.from({ length: blades }, (_, i) => {
        const a = rot + (i / blades) * TAU;
        return [R + Math.cos(a) * ap, R + Math.sin(a) * ap] as const;
      });
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, outer, 0, TAU);
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = rgba(lerp(p.deep, alt, 0.12), p.light ? 0.85 : 0.95);
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.arc(R, R, outer, 0, TAU);
      ctx.clip();
      ctx.lineWidth = Math.max(1, R * 0.01);
      ctx.strokeStyle = rgba(c, 0.45 + e * 0.35);
      corners.forEach(([x, y], i) => {
        const [nx, ny] = corners[(i + 1) % blades] ?? [x, y];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (x - nx) * 6, y + (y - ny) * 6);
        ctx.stroke();
      });
      ctx.restore();
      ctx.lineWidth = Math.max(2, R * 0.06);
      ctx.strokeStyle = rgba(lerp(p.deep, c, 0.25), 0.95);
      ctx.beginPath();
      ctx.arc(R, R, outer + R * 0.03, 0, TAU);
      ctx.stroke();
      rim(env, outer + R * 0.065, 0.6);
      if (hud) ticks(env, 0.97, -0.05);
    },
  };
}

interface Firefly {
  axis: Vec;
  r: number;
  speed: number;
  phase: number;
  flicker: number;
}

/** Firefly swarm: glowing motes circle the core on tilted orbits and scatter wider as it speaks. */
export function swarm(size: number): OrbStyle {
  const n = size >= 150 ? 150 : 50;
  const flies: Firefly[] = Array.from({ length: n }, () => ({
    axis: [Math.random() * TAU, Math.random() * 1.4 - 0.7, 0],
    r: 0.25 + Math.random() * 0.45,
    speed: (0.4 + Math.random() * 0.9) * (Math.random() < 0.5 ? -1 : 1),
    phase: Math.random() * TAU,
    flicker: 1 + Math.random() * 3,
  }));
  let phase = 0;
  return {
    draw(env) {
      const { ctx, R, e, dt, t, c, alt, p, still } = env;
      if (!still) phase += dt * (0.6 + e * 2.5);
      glow(ctx, R, R, R * 0.3 * (1 + e), c, 0.55);
      glow(ctx, R, R, R * 0.08, p.hi, 0.9);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      for (const fly of flies) {
        const a = fly.phase + phase * fly.speed;
        const spread = fly.r * (1 + e * 0.5);
        const v = project(
          [Math.cos(a) * spread, Math.sin(a) * spread * 0.6, Math.sin(a) * spread * 0.8],
          fly.axis[0],
          fly.axis[1],
        );
        const lit = 0.5 + 0.5 * Math.sin(t * fly.flicker + fly.phase);
        const depth = (v[2] + 1) / 2;
        const col = lerp(alt, c, depth);
        const [x, y] = [R + v[0] * R, R + v[1] * R];
        const size = R * (0.012 + depth * 0.018);
        ctx.fillStyle = rgba(col, (0.08 + lit * 0.12) * (0.5 + depth));
        ctx.beginPath();
        ctx.arc(x, y, size * 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(lerp(col, p.hi, 0.6), 0.4 + lit * 0.6);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    },
  };
}

/** Icosahedron corners (unit sphere) and its 30 edges. */
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO: Vec[] = [
  [0, 1, PHI],
  [0, 1, -PHI],
  [0, -1, PHI],
  [0, -1, -PHI],
  [1, PHI, 0],
  [1, -PHI, 0],
  [-1, PHI, 0],
  [-1, -PHI, 0],
  [PHI, 0, 1],
  [PHI, 0, -1],
  [-PHI, 0, 1],
  [-PHI, 0, -1],
].map(([x = 0, y = 0, z = 0]) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l] as Vec;
});
const ICO_EDGES: Array<[number, number]> = [];
for (let i = 0; i < ICO.length; i++)
  for (let j = i + 1; j < ICO.length; j++) {
    const [a, b] = [ICO[i], ICO[j]];
    if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1.1) ICO_EDGES.push([i, j]);
  }

/** Crystal: two counter-turning icosahedrons around a burning core, like a cut gem catching light. */
export function crystal(): OrbStyle {
  function gem(env: Env, r: number, yaw: number, pitch: number, col: Rgb, width: number): void {
    const { ctx, R, e, p } = env;
    const pts = ICO.map((v) => project(v, yaw, pitch));
    ctx.lineWidth = width;
    for (const [i, j] of ICO_EDGES) {
      const [u, v] = [pts[i], pts[j]];
      if (!u || !v) continue;
      const depth = (u[2] + v[2] + 2) / 4;
      ctx.strokeStyle = rgba(lerp(col, p.hi, depth * 0.4), 0.15 + depth * (0.7 + e * 0.2));
      ctx.beginPath();
      ctx.moveTo(R + u[0] * r, R + u[1] * r);
      ctx.lineTo(R + v[0] * r, R + v[1] * r);
      ctx.stroke();
    }
  }
  return {
    draw(env) {
      const { ctx, R, e, spin, c, alt, p } = env;
      halo(env, 0.7);
      glow(ctx, R, R, R * 0.4 * (1 + e * 0.6), c, 0.6);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      gem(env, R * 0.78 * (1 + e * 0.08), spin * 0.5, 0.5, c, Math.max(1, R * 0.014));
      gem(env, R * 0.42, -spin * 0.9, 1.1, alt, Math.max(1, R * 0.01));
      ctx.restore();
      glow(ctx, R, R, R * 0.1, p.hi, 1);
    },
  };
}
