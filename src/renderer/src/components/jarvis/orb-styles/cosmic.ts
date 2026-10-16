import { TAU, additive, glow, lerp, rgba, type Env, type OrbStyle } from '../orb-kit';
import { halo } from './parts';

/** Big, cinematic styles: a black hole and a galaxy. */

interface Star {
  r: number;
  a: number;
  size: number;
}

/** Black hole: an accretion disk of particles orbiting the dark, with a bright photon ring. */
export function blackhole(size: number): OrbStyle {
  const n = size >= 150 ? 900 : 300;
  const stars: Star[] = Array.from({ length: n }, () => ({
    r: 0.38 + Math.random() ** 1.6 * 0.55,
    a: Math.random() * TAU,
    size: 0.6 + Math.random() * 1.2,
  }));
  function disk(env: Env, front: boolean): void {
    const { ctx, R, e, c, p } = env;
    for (const s of stars) {
      const y = Math.sin(s.a);
      if (front !== y > 0) continue;
      const x = R + Math.cos(s.a) * s.r * R;
      const yy = R + y * s.r * R * 0.32;
      const heat = 1 - (s.r - 0.38) / 0.55;
      ctx.fillStyle = rgba(lerp(c, p.mark, heat * 0.7), 0.25 + heat * 0.6 + e * 0.2);
      const px = Math.max(1, R * 0.01 * s.size);
      ctx.fillRect(x - px / 2, yy - px / 2, px, px);
    }
  }
  return {
    draw(env) {
      const { ctx, R, e, dt, c, alt, p, still } = env;
      if (!still) for (const s of stars) s.a += (dt * (0.35 + e * 1.5)) / (s.r * s.r * 3);
      glow(ctx, R, R, R, alt, 0.15 + e * 0.15);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      disk(env, false);
      ctx.restore();
      // Lensed light bent over the top of the hole.
      ctx.lineWidth = Math.max(1, R * 0.02);
      ctx.strokeStyle = rgba(lerp(c, p.mark, 0.4), 0.5 + e * 0.4);
      ctx.beginPath();
      ctx.ellipse(R, R - R * 0.02, R * 0.42, R * 0.36, 0, Math.PI, TAU);
      ctx.stroke();
      ctx.fillStyle = rgba([0, 0, 0], 1);
      ctx.beginPath();
      ctx.arc(R, R, R * 0.3, 0, TAU);
      ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.015);
      ctx.strokeStyle = rgba(lerp(c, p.hi, 0.5), 0.9);
      ctx.shadowColor = rgba(c, 1);
      ctx.shadowBlur = R * 0.1;
      ctx.beginPath();
      ctx.arc(R, R, R * 0.31, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      disk(env, true);
      ctx.restore();
    },
  };
}

/** Galaxy: spiral arms of stars turning around a bright core. */
export function galaxy(size: number): OrbStyle {
  const n = size >= 150 ? 1100 : 350;
  const stars = Array.from({ length: n }, (_, i) => {
    const arm = i % 3;
    const d = Math.random() ** 0.8;
    return {
      d,
      a: arm * ((2 * Math.PI) / 3) + d * 5 + (Math.random() - 0.5) * 0.6 * (1 - d * 0.5),
      s: 0.5 + Math.random() * 1.3,
    };
  });
  return {
    draw(env) {
      const { ctx, R, e, spin, c, alt, p } = env;
      halo(env, 0.6);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      const tilt = 0.55;
      for (const s of stars) {
        const a = s.a + spin * (0.6 / (0.3 + s.d));
        const r = s.d * R * 0.85 * (1 + e * 0.1);
        const x = R + Math.cos(a) * r;
        const y = R + Math.sin(a) * r * tilt;
        ctx.fillStyle = rgba(
          lerp(lerp(p.hi, c, s.d * 1.5 > 1 ? 1 : s.d * 1.5), alt, Math.max(0, s.d - 0.5)),
          0.3 + (1 - s.d) * 0.6 + e * 0.2,
        );
        const px = Math.max(1, R * 0.008 * s.s);
        ctx.fillRect(x - px / 2, y - px / 2, px, px);
      }
      ctx.restore();
      glow(ctx, R, R, R * 0.28 * (1 + e * 0.5), c, 0.7);
      glow(ctx, R, R, R * 0.09, p.hi, 1);
    },
  };
}
