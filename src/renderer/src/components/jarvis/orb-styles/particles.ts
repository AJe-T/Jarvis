import {
  HUD_MIN_PX,
  TAU,
  additive,
  fibonacciSphere,
  rgba,
  segmentColour,
  wobble,
  type Env,
  type OrbStyle,
} from '../orb-kit';
import {
  createDotStyles,
  createSparks,
  glyphRing,
  halo,
  markers,
  segmentedArcs,
  ticks,
} from './parts';

function detailFor(size: number): {
  sphere: number;
  shells: number;
  shellPoints: number;
  ring: number;
} {
  if (size >= 300) return { sphere: 1500, shells: 3, shellPoints: 240, ring: 96 };
  if (size >= 150) return { sphere: 900, shells: 3, shellPoints: 160, ring: 72 };
  if (size >= HUD_MIN_PX) return { sphere: 420, shells: 2, shellPoints: 110, ring: 48 };
  return { sphere: 150, shells: 1, shellPoints: 60, ring: 28 };
}

/**
 * Particle core (default): a breathing sphere of dots whose surface ripples with the level and
 * shades from the accent to the second neon; wavy particle shells; a hot core with filaments; a
 * ring of level dots (tool segments while acting); sparks; the HUD around it.
 */
export function particles(size: number): OrbStyle {
  const d = detailFor(size);
  const points = fibonacciSphere(d.sphere);
  const dots = createDotStyles();
  const sparks = createSparks();

  function shells(env: Env): void {
    const { ctx, R, e, t, spin } = env;
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
        const depth = 0.5 + (0.5 * y0 * st) / r;
        const px = Math.max(1, R * 0.008 * (0.6 + depth));
        ctx.fillStyle = dots.at(0.35 + k * 0.25, (0.18 + 0.45 * depth) * (0.6 + e * 0.6));
        ctx.fillRect(R + x - px / 2, R + y0 * ct - px / 2, px, px);
      }
    }
  }

  function sphere(env: Env, sphereR: number): void {
    const { ctx, R, e, t, spin } = env;
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
      const depth = (y * sx + z1 * cx + 1) / 2;
      const px = dot * (0.45 + 0.9 * depth);
      ctx.fillStyle = dots.at((x1 + 1) / 2, 0.12 + 0.8 * depth * depth + e * 0.15);
      ctx.fillRect(R + x1 * sphereR * k - px / 2, R + y2 * sphereR * k - px / 2, px, px);
    }
  }

  function core(env: Env, sphereR: number): void {
    const { ctx, R, e, t, spin, c, alt, p, hud } = env;
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
    if (!hud) return;
    for (let s = 0; s < 4; s++) {
      const ph = t * (0.6 + s * 0.17) + s * 1.9;
      for (let i = 0; i < 70; i++) {
        const u = (i / 70) * TAU;
        const x = Math.sin(2 * u + ph) * Math.cos(u * 0.5 + spin);
        const y = Math.sin(3 * u - ph * 0.7) * 0.8;
        const px = Math.max(1, R * 0.007);
        ctx.fillStyle = dots.at(s / 4, 0.25 + e * 0.4);
        ctx.fillRect(R + x * rc * 1.15 - px / 2, R + y * rc * 1.15 - px / 2, px, px);
      }
    }
  }

  function levelRing(env: Env): void {
    const { ctx, R, e, t, hud } = env;
    const n = d.ring;
    const r0 = R * (hud ? 0.53 : 0.64);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const jump =
        e * R * 0.12 * (0.55 + 0.45 * Math.sin(i * 1.9 + t * 4.2) * Math.sin(i * 0.43 - t * 1.7));
      ctx.fillStyle = segmentColour(env, i, n);
      const count = hud ? 3 : 1;
      for (let k = 0; k < count; k++) {
        const r = r0 + (jump * (k + 1)) / count;
        const px = Math.max(1.2, R * 0.012) * (1 - k * 0.2);
        ctx.fillRect(R + Math.cos(a) * r - px / 2, R + Math.sin(a) * r - px / 2, px, px);
      }
    }
  }

  return {
    ownsSteps: true,
    draw(env) {
      const { ctx, R, hud } = env;
      const sphereR = R * (hud ? 0.42 : 0.5);
      dots.use(env.c, env.alt);
      halo(env);
      if (hud) {
        ticks(env);
        segmentedArcs(env);
        glyphRing(env);
      }
      ctx.globalCompositeOperation = additive(env);
      shells(env);
      sphere(env, sphereR);
      core(env, sphereR);
      levelRing(env);
      if (hud) sparks(env, sphereR);
      ctx.globalCompositeOperation = 'source-over';
      if (hud) markers(env);
    },
  };
}
