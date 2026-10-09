import {
  TAU,
  additive,
  glow,
  lerp,
  project,
  rgba,
  segmentColour,
  type Env,
  type OrbStyle,
  type Vec,
} from '../orb-kit';
import { halo, markers, ticks } from './parts';

/** Instrument-like styles: meters, scopes, sonar, globes and rings. */

/** Radial equalizer: bars around a ring, mirrored inward, coloured from accent to the second neon. */
export function equalizer(size: number): OrbStyle {
  const n = size >= 150 ? 96 : 40;
  return {
    ownsSteps: true,
    draw(env) {
      const { ctx, R, e, t, c, alt } = env;
      const r0 = R * 0.48;
      glow(ctx, R, R, R, c, 0.15 + e * 0.2);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, ((TAU * r0) / n) * 0.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU - Math.PI / 2;
        const w = 0.5 + 0.5 * Math.sin(i * 0.9 + t * 5) * Math.sin(i * 0.31 - t * 2.2);
        const out = R * (0.04 + e * 0.42 * w);
        const [cos, sin] = [Math.cos(a), Math.sin(a)];
        const col =
          env.f.state === 'ACTING' || env.f.state === 'THINKING'
            ? segmentColour(env, i, n)
            : rgba(lerp(c, alt, Math.abs(Math.sin(a / 2))), 0.85);
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(R + cos * (r0 - out * 0.35), R + sin * (r0 - out * 0.35));
        ctx.lineTo(R + cos * (r0 + out), R + sin * (r0 + out));
        ctx.stroke();
      }
      ctx.lineWidth = Math.max(1, R * 0.012);
      ctx.strokeStyle = rgba(c, 0.6);
      ctx.beginPath();
      ctx.arc(R, R, r0 * 0.7, 0, TAU);
      ctx.stroke();
      glow(ctx, R, R, r0 * 0.6, c, 0.35 + e * 0.4);
    },
  };
}

/** Sonar pulse: rings ripple out (faster when loud), a radar arm sweeps and blips fade. */
export function sonar(): OrbStyle {
  const pulses: number[] = [];
  let lastPulse = 0;
  return {
    draw(env) {
      const { ctx, R, e, t, dt, c, alt, spin, still } = env;
      halo(env, 0.6);
      if (!still && t - lastPulse > 1.4 / (1 + e * 4)) {
        pulses.push(0);
        lastPulse = t;
      }
      ctx.lineWidth = Math.max(1, R * 0.012);
      for (let i = pulses.length - 1; i >= 0; i--) {
        const age = (pulses[i] ?? 0) + dt * (0.45 + e);
        pulses[i] = age;
        if (age >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = rgba(c, (1 - age) * 0.8);
        ctx.beginPath();
        ctx.arc(R, R, R * (0.12 + age * 0.85), 0, TAU);
        ctx.stroke();
      }
      const a = spin * 1.5;
      const g = ctx.createConicGradient(a - 0.9, R, R);
      g.addColorStop(0, rgba(alt, 0));
      g.addColorStop(0.143, rgba(alt, 0.4));
      g.addColorStop(0.1431, rgba(alt, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(R, R, R * 0.92, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(c, 0.25);
      for (const k of [0.35, 0.65, 0.92]) {
        ctx.beginPath();
        ctx.arc(R, R, R * k, 0, TAU);
        ctx.stroke();
      }
      glow(ctx, R, R, R * 0.12 * (1 + e), c, 0.95);
    },
  };
}

/** Oscilloscope: a glowing Lissajous trace whose ratio drifts and amplitude follows the level. */
export function scope(): OrbStyle {
  return {
    draw(env) {
      const { ctx, R, e, t, c, alt } = env;
      halo(env, 0.5);
      ctx.strokeStyle = rgba(c, 0.15);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(R * 0.15, R);
      ctx.lineTo(R * 1.85, R);
      ctx.moveTo(R, R * 0.15);
      ctx.lineTo(R, R * 1.85);
      ctx.arc(R, R, R * 0.85, 0, TAU);
      ctx.stroke();
      const ratio = 2 + Math.round(1 + Math.sin(t * 0.1));
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      ctx.lineJoin = 'round';
      for (let trail = 3; trail >= 0; trail--) {
        const ph = t * 1.2 - trail * 0.06;
        const amp = R * (0.45 + e * 0.35);
        ctx.beginPath();
        for (let i = 0; i <= 240; i++) {
          const u = (i / 240) * TAU;
          const x = R + Math.sin(ratio * u + ph) * amp;
          const y = R + Math.sin((ratio + 1) * u) * amp * (0.9 + 0.1 * Math.sin(t));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = Math.max(1, R * (trail === 0 ? 0.018 : 0.01));
        ctx.strokeStyle = rgba(trail === 0 ? c : alt, trail === 0 ? 0.95 : 0.18);
        ctx.shadowColor = rgba(c, 1);
        ctx.shadowBlur = trail === 0 ? R * 0.06 : 0;
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

/** Holo globe: a turning wireframe planet of latitude and longitude lines. */
export function globe(size: number): OrbStyle {
  const seg = size >= 150 ? 64 : 32;
  const lines: Vec[][] = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = Math.sin((lat * Math.PI) / 180);
    const r = Math.cos((lat * Math.PI) / 180);
    lines.push(
      Array.from(
        { length: seg + 1 },
        (_, i) => [Math.cos((i / seg) * TAU) * r, y, Math.sin((i / seg) * TAU) * r] as Vec,
      ),
    );
  }
  for (let k = 0; k < 12; k++) {
    const lon = (k / 12) * Math.PI;
    lines.push(
      Array.from({ length: seg + 1 }, (_, i) => {
        const a = (i / seg) * TAU;
        return [Math.cos(a) * Math.cos(lon), Math.sin(a), Math.cos(a) * Math.sin(lon)] as Vec;
      }),
    );
  }
  return {
    draw(env) {
      const { ctx, R, e, t, c, alt, spin, hud } = env;
      halo(env, 0.7);
      const r = R * 0.6 * (1 + e * 0.1);
      const pitch = 0.4 + Math.sin(t * 0.2) * 0.1;
      ctx.lineWidth = Math.max(0.8, R * 0.008);
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const a = project(line[i - 1] ?? [0, 0, 0], spin, pitch);
          const b = project(line[i] ?? [0, 0, 0], spin, pitch);
          const depth = (a[2] + 1) / 2;
          ctx.strokeStyle = rgba(lerp(alt, c, depth), 0.12 + depth * 0.75 * (0.7 + e * 0.5));
          ctx.beginPath();
          ctx.moveTo(R + a[0] * r, R + a[1] * r);
          ctx.lineTo(R + b[0] * r, R + b[1] * r);
          ctx.stroke();
        }
      }
      glow(ctx, R, R, r * 0.5, c, 0.25 + e * 0.35);
      if (hud) {
        ticks(env, 0.95, 0.15);
        markers(env, 0.92);
      }
    },
  };
}

/** A circle in 3D (unit radius) as points, for ring styles. */
function ring3d(n: number): Vec[] {
  return Array.from(
    { length: n + 1 },
    (_, i) => [Math.cos((i / n) * TAU), Math.sin((i / n) * TAU), 0] as Vec,
  );
}

function strokeRing(
  env: Env,
  pts: Vec[],
  r: number,
  yaw: number,
  pitch: number,
  colour: readonly [number, number, number],
  width: number,
): void {
  const { ctx, R, e } = env;
  ctx.lineWidth = width;
  for (let i = 1; i < pts.length; i++) {
    const a = project(pts[i - 1] ?? [0, 0, 0], yaw, pitch);
    const b = project(pts[i] ?? [0, 0, 0], yaw, pitch);
    ctx.strokeStyle = rgba(colour, 0.2 + ((a[2] + 1) / 2) * (0.6 + e * 0.3));
    ctx.beginPath();
    ctx.moveTo(R + a[0] * r, R + a[1] * r);
    ctx.lineTo(R + b[0] * r, R + b[1] * r);
    ctx.stroke();
  }
}

/** Gyroscope: three rings spinning on their own axes around a glowing core. */
export function gyroscope(size: number): OrbStyle {
  const pts = ring3d(size >= 150 ? 96 : 48);
  return {
    draw(env) {
      const { ctx, R, e, spin, c, alt, p } = env;
      halo(env, 0.7);
      const w = Math.max(1.2, R * (0.018 + e * 0.02));
      strokeRing(env, pts, R * 0.82, spin * 0.9, 1.2, c, w);
      strokeRing(env, pts, R * 0.7, spin * -1.3 + 1, 0.4 + spin * 0.3, alt, w);
      strokeRing(env, pts, R * 0.58, 1.57 + spin * 0.6, spin * 1.1, p.mark, w * 0.8);
      glow(ctx, R, R, R * 0.35 * (1 + e * 0.5), c, 0.8);
      glow(ctx, R, R, R * 0.1, p.hi, 1);
    },
  };
}

/** Atom: a nucleus with electrons racing round three orbits (faster when loud). */
export function atom(size: number): OrbStyle {
  const pts = ring3d(size >= 150 ? 96 : 48);
  let phase = 0;
  return {
    draw(env) {
      const { ctx, R, e, dt, c, alt, p, still } = env;
      halo(env, 0.6);
      if (!still) phase += dt * (1.2 + e * 5);
      const tilts = [0, Math.PI / 3, (2 * Math.PI) / 3];
      tilts.forEach((tilt, k) => {
        ctx.save();
        ctx.translate(R, R);
        ctx.rotate(tilt);
        ctx.translate(-R, -R);
        strokeRing(env, pts, R * 0.8, 0, 1.25, k === 1 ? alt : c, Math.max(1, R * 0.01));
        const a = phase * (1 + k * 0.2) + k * 2;
        const [x, y] = [R + Math.cos(a) * R * 0.8, R + Math.sin(a) * R * 0.8 * Math.cos(1.25)];
        glow(ctx, x, y, R * 0.09, p.hi, 0.95);
        glow(ctx, x, y, R * 0.16, c, 0.6);
        ctx.restore();
      });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + phase * 0.3;
        glow(
          ctx,
          R + Math.cos(a) * R * 0.07,
          R + Math.sin(a) * R * 0.07,
          R * 0.1,
          i % 2 ? alt : c,
          0.8,
        );
      }
      glow(ctx, R, R, R * 0.06 * (1 + e), p.hi, 1);
    },
  };
}

/** Light ring (smart-speaker style): a thick ring with a running light that brightens with speech. */
export function ring(): OrbStyle {
  return {
    ownsSteps: true,
    draw(env) {
      const { ctx, R, e, spin, c, alt, p, f } = env;
      const r = R * 0.7;
      glow(ctx, R, R, R, c, 0.12 + e * 0.25);
      ctx.lineWidth = R * (0.13 + e * 0.05);
      ctx.strokeStyle = rgba(p.deep, 0.9);
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.stroke();
      const n = 48;
      ctx.lineWidth = R * (0.1 + e * 0.05);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU - Math.PI / 2;
        const run = Math.max(0, Math.cos(a - spin * 2));
        ctx.strokeStyle =
          f.state === 'ACTING' && f.steps.length
            ? segmentColour(env, i, n)
            : rgba(lerp(alt, c, run), 0.25 + run * 0.6 + e * 0.4);
        ctx.beginPath();
        ctx.arc(R, R, r, a, a + TAU / n + 0.01);
        ctx.stroke();
      }
      glow(ctx, R, R, r * 0.55, c, 0.12 + e * 0.3);
    },
  };
}
