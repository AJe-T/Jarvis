import { TAU, additive, glow, lerp, rgba, segmentColour, type OrbStyle } from '../orb-kit';
import { halo } from './parts';

/** Instrument-like styles: meters, scopes and rings. */

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
