import {
  HUD_MIN_PX,
  TAU,
  fibonacciSphere,
  rgba,
  segmentColour,
  type Env,
  type OrbStyle,
} from '../orb-kit';
import { halo, markers, ticks } from './parts';

const DOTS = fibonacciSphere(140);
const ARCS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.95],
  [1.2, 0.32],
  [1.72, 1.15],
  [3.1, 0.22],
  [3.52, 1.25],
  [5.0, 0.85],
];

/** Arc reactor (v2.1): radar sweep, segmented arcs, a counter-ring, level bars and a plasma core. */
export function reactor(size: number): OrbStyle {
  const hudOn = size >= HUD_MIN_PX;
  const detailed = size >= 48;

  function sweep(env: Env): void {
    const { ctx, R, spin, c, alt } = env;
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

  function arcs(env: Env): void {
    const { ctx, R, spin, c, alt, e } = env;
    ctx.save();
    ctx.translate(R, R);
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

  function bars(env: Env, barR: number): void {
    const { ctx, R, e, t } = env;
    const n = detailed ? 90 : 28;
    ctx.lineWidth = Math.max(1, ((TAU * barR) / n) * 0.42);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const w = 0.55 + 0.45 * Math.sin(i * 1.9 + t * 4.2) * Math.sin(i * 0.43 - t * 1.7);
      const len = R * (0.035 + e * 0.2 * w + 0.01 * Math.sin(i + t * 2));
      ctx.beginPath();
      ctx.moveTo(R + Math.cos(a) * barR, R + Math.sin(a) * barR);
      ctx.lineTo(R + Math.cos(a) * (barR + len), R + Math.sin(a) * (barR + len));
      ctx.strokeStyle = segmentColour(env, i, n);
      ctx.stroke();
    }
  }

  function core(env: Env, coreR: number): void {
    const { ctx, R, e, t, spin, c, alt, p } = env;
    const ring = R * (hudOn ? 0.5 : 0.45) * (1 + e * 0.04);
    ctx.save();
    ctx.shadowColor = rgba(c, 0.95);
    ctx.shadowBlur = R * 0.22;
    ctx.lineWidth = Math.max(1, R * 0.026);
    ctx.strokeStyle = rgba(c, 0.95);
    ctx.beginPath();
    ctx.arc(R, R, ring, 0, TAU);
    ctx.stroke();
    ctx.restore();
    const rc = coreR * (1 + e * 0.08);
    const g = ctx.createRadialGradient(R - rc * 0.25, R - rc * 0.3, rc * 0.05, R, R, rc);
    g.addColorStop(0, rgba(p.hi, 0.9));
    g.addColorStop(0.45, rgba(c, 0.55));
    g.addColorStop(1, rgba(p.deep, 1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(R, R, rc, 0, TAU);
    ctx.fill();
    if (!detailed) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, rc, 0, TAU);
    ctx.clip();
    ctx.globalCompositeOperation = p.light ? 'source-over' : 'lighter';
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
        const [x, y] = [R + Math.cos(a + turn) * rr, R + Math.sin(a + turn) * rr];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(k % 2 ? alt : p.hi, 0.16 + e * 0.3);
      ctx.stroke();
    }
    for (const [x, y, z] of DOTS) {
      const x1 = x * Math.cos(spin) + z * Math.sin(spin);
      const z1 = -x * Math.sin(spin) + z * Math.cos(spin);
      if (z1 < -0.1) continue;
      ctx.fillStyle = rgba(p.hi, 0.12 + 0.5 * z1 + e * 0.2);
      ctx.fillRect(
        R + x1 * rc * 0.96,
        R + y * rc * 0.96,
        Math.max(1, rc * 0.04),
        Math.max(1, rc * 0.04),
      );
    }
    ctx.restore();
  }

  return {
    ownsSteps: true,
    draw(env) {
      const { R } = env;
      halo(env);
      if (hudOn) {
        ticks(env, 0.97, -0.12);
        sweep(env);
        arcs(env);
      }
      bars(env, R * (hudOn ? 0.58 : 0.53));
      core(env, R * (hudOn ? 0.4 : 0.36));
      if (hudOn) markers(env, 0.925);
    },
  };
}
