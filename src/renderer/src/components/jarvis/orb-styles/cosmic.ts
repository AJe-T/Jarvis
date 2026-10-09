import { TAU, additive, glow, lerp, rgba, type Env, type OrbStyle, type Rgb } from '../orb-kit';
import { createSparks, glyphRing, halo, segmentedArcs } from './parts';

/** Big, cinematic styles: a spell circle, a black hole, a galaxy, digital rain. */

function polygon(
  env: Env,
  sides: number,
  r: number,
  rot: number,
  colour: Rgb,
  alpha: number,
): void {
  const { ctx, R } = env;
  ctx.strokeStyle = rgba(colour, alpha);
  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const a = rot + (i / sides) * TAU;
    const [x, y] = [R + Math.cos(a) * r, R + Math.sin(a) * r];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Sorcery circle (the Doctor Strange reference): rotating rune rings, a star, spokes and sparks. */
export function mandala(): OrbStyle {
  const sparks = createSparks(120);
  return {
    draw(env) {
      const { ctx, R, e, spin, c, p, hud } = env;
      const warm = lerp(p.mark, c, 0.35);
      halo(env, 0.8);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      ctx.lineWidth = Math.max(1, R * 0.012);
      ctx.shadowColor = rgba(warm, 1);
      ctx.shadowBlur = R * 0.05;
      for (const [k, speed] of [
        [0.9, 0.3],
        [0.78, -0.45],
        [0.5, 0.6],
      ] as const) {
        ctx.strokeStyle = rgba(warm, 0.55 + e * 0.4);
        ctx.beginPath();
        ctx.arc(R, R, R * k, 0, TAU);
        ctx.stroke();
        if (hud) glyphRing(env, k - 0.05, speed, warm);
      }
      polygon(env, 4, R * 0.78, spin * 0.3, warm, 0.6 + e * 0.3);
      polygon(env, 4, R * 0.78, spin * 0.3 + Math.PI / 4, warm, 0.6 + e * 0.3);
      polygon(env, 3, R * 0.5, -spin * 0.5, c, 0.7);
      polygon(env, 3, R * 0.5, -spin * 0.5 + Math.PI, c, 0.7);
      ctx.strokeStyle = rgba(warm, 0.3);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + spin * 0.15;
        ctx.beginPath();
        ctx.moveTo(R + Math.cos(a) * R * 0.5, R + Math.sin(a) * R * 0.5);
        ctx.lineTo(R + Math.cos(a) * R * 0.9, R + Math.sin(a) * R * 0.9);
        ctx.stroke();
      }
      if (hud) segmentedArcs(env, 0.96, 0.2, warm);
      ctx.restore();
      glow(ctx, R, R, R * 0.3 * (1 + e * 0.6), warm, 0.6);
      if (hud) sparks(env, R * 0.85, [p.mark, warm, c]);
    },
  };
}

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

const GLYPHS = 'アイウエオカキクケコサシスセソ0123456789ABCDEF<>/*+=';

/** Digital rain: columns of falling code inside a sphere; they fall faster when Jarvis talks. */
export function rain(size: number): OrbStyle {
  const cols = size >= 150 ? 22 : 10;
  const heads = Array.from({ length: cols }, () => Math.random());
  return {
    draw(env) {
      const { ctx, R, e, dt, c, p, still } = env;
      const r = R * 0.72;
      glow(ctx, R, R, R, c, 0.12 + e * 0.15);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = rgba(p.deep, p.light ? 0.2 : 0.75);
      ctx.fillRect(R - r, R - r, r * 2, r * 2);
      const cell = (r * 2) / cols;
      ctx.font = `${Math.max(6, cell * 0.9)}px "Geist Mono", monospace`;
      ctx.textAlign = 'center';
      const rows = cols;
      heads.forEach((h, i) => {
        const next = still ? h : (h + dt * (0.25 + e * 1.2) * (0.6 + (i % 5) * 0.12)) % 1.3;
        heads[i] = next;
        const head = Math.floor(next * rows);
        for (let k = 0; k < 8; k++) {
          const row = head - k;
          if (row < 0 || row >= rows) continue;
          const ch =
            GLYPHS[
              (i * 7 + row * 13 + Math.floor(env.t * 4 * (k === 0 ? 1 : 0))) % GLYPHS.length
            ] ?? '0';
          ctx.fillStyle = k === 0 ? rgba(p.hi, 0.95) : rgba(c, 0.85 - k * 0.1);
          ctx.fillText(ch, R - r + cell * (i + 0.5), R - r + cell * (row + 0.9));
        }
      });
      ctx.restore();
      ctx.lineWidth = Math.max(1, R * 0.012);
      ctx.strokeStyle = rgba(c, 0.6);
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.stroke();
    },
  };
}
