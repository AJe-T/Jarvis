import {
  TAU,
  additive,
  glow,
  lerp,
  rgba,
  wobble,
  type Env,
  type OrbStyle,
  type Rgb,
} from '../orb-kit';

/** Glassy, organic styles: colour that moves like liquid, light, fire and lightning. */

/** A glass sphere edge with a soft top highlight. */
function glassRim(env: Env, r: number): void {
  const { ctx, R, c, p } = env;
  ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.strokeStyle = rgba(lerp(c, p.hi, 0.6), 0.55);
  ctx.beginPath();
  ctx.arc(R, R, r, 0, TAU);
  ctx.stroke();
  const g = ctx.createLinearGradient(R, R - r, R, R);
  g.addColorStop(0, rgba(p.hi, 0.35));
  g.addColorStop(1, rgba(p.hi, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(R, R - r * 0.55, r * 0.55, r * 0.28, 0, 0, TAU);
  ctx.fill();
}

/** Fluid glass (Siri-like): coloured blobs swirl and merge inside a glass sphere. */
export function fluid(): OrbStyle {
  return {
    draw(env) {
      const { ctx, R, e, t, c, alt, p } = env;
      const r = R * 0.62 * (1 + e * 0.1);
      glow(ctx, R, R, R, c, 0.18 + e * 0.25);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = rgba(p.deep, p.light ? 0.25 : 0.85);
      ctx.fillRect(R - r, R - r, r * 2, r * 2);
      ctx.globalCompositeOperation = additive(env);
      const colours: Rgb[] = [c, alt, p.mark, lerp(c, p.hi, 0.5)];
      colours.forEach((col, i) => {
        const a = t * (0.5 + i * 0.23) + i * 1.7;
        const d = r * (0.3 + 0.15 * Math.sin(t * 0.9 + i) + e * 0.15);
        glow(
          ctx,
          R + Math.cos(a) * d,
          R + Math.sin(a * 1.3) * d,
          r * (0.75 + e * 0.35),
          col,
          0.55 + e * 0.3,
        );
      });
      ctx.restore();
      glassRim(env, r);
    },
  };
}

/** Voice cloud (ChatGPT-voice-like): a soft sphere of drifting cloud that swells as it speaks. */
export function cloud(): OrbStyle {
  return {
    draw(env) {
      const { ctx, R, e, t, c, alt, p } = env;
      const r = R * 0.6 * (1 + e * 0.18);
      const base = ctx.createRadialGradient(R - r * 0.3, R - r * 0.4, r * 0.1, R, R, r);
      base.addColorStop(0, rgba(p.hi, 0.95));
      base.addColorStop(0.5, rgba(c, 0.9));
      base.addColorStop(1, rgba(alt, 0.95));
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.fillStyle = base;
      ctx.fill();
      ctx.clip();
      for (let i = 0; i < 6; i++) {
        const a = t * 0.25 * (i % 2 ? 1 : -1) + i;
        const x = R + Math.cos(a) * r * 0.55;
        const y = R + Math.sin(a * 0.8 + t * 0.2) * r * 0.5;
        glow(ctx, x, y, r * (0.45 + 0.1 * Math.sin(t + i)), p.hi, 0.35);
      }
      ctx.restore();
      glow(ctx, R, R, R, c, 0.12 + e * 0.2);
    },
  };
}

/** Liquid metal: a morphing blob with rippled contour lines. */
export function liquid(): OrbStyle {
  function blob(env: Env, scale: number): void {
    const { ctx, R, e, t } = env;
    const amp = 0.05 + e * 0.2;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU;
      const k = 1 + amp * wobble(Math.cos(a) * 1.4, Math.sin(a) * 1.4, scale, t * 1.2);
      const r = R * 0.55 * scale * k;
      const [x, y] = [R + Math.cos(a) * r, R + Math.sin(a) * r];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  return {
    draw(env) {
      const { ctx, R, e, c, alt, p } = env;
      glow(ctx, R, R, R, c, 0.15 + e * 0.2);
      const g = ctx.createRadialGradient(R - R * 0.2, R - R * 0.25, R * 0.05, R, R, R * 0.7);
      g.addColorStop(0, rgba(p.hi, 0.95));
      g.addColorStop(0.35, rgba(c, 0.9));
      g.addColorStop(0.8, rgba(alt, 0.9));
      g.addColorStop(1, rgba(p.deep, 1));
      blob(env, 1);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, R * 0.006);
      for (let k = 1; k <= 6; k++) {
        blob(env, 1 - k * 0.12);
        ctx.strokeStyle = rgba(p.hi, 0.25 - k * 0.03);
        ctx.stroke();
      }
    },
  };
}

/** Solar flare: a burning core with a flickering corona. */
export function sun(size: number): OrbStyle {
  const rays = size >= 150 ? 160 : 60;
  return {
    draw(env) {
      const { ctx, R, e, t, c, p, spin } = env;
      const r = R * 0.36 * (1 + e * 0.08);
      glow(ctx, R, R, R, c, 0.25 + e * 0.3);
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      ctx.lineWidth = Math.max(1, R * 0.01);
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + spin * 0.2;
        const n = 0.5 + 0.5 * wobble(Math.cos(a) * 3, Math.sin(a) * 3, 0, t * 2);
        const len = R * (0.08 + n * (0.18 + e * 0.35));
        const g = ctx.createLinearGradient(
          R + Math.cos(a) * r,
          R + Math.sin(a) * r,
          R + Math.cos(a) * (r + len),
          R + Math.sin(a) * (r + len),
        );
        g.addColorStop(0, rgba(p.mark, 0.8));
        g.addColorStop(1, rgba(c, 0));
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(R + Math.cos(a) * r, R + Math.sin(a) * r);
        ctx.lineTo(R + Math.cos(a) * (r + len), R + Math.sin(a) * (r + len));
        ctx.stroke();
      }
      ctx.restore();
      const core = ctx.createRadialGradient(R, R, 0, R, R, r);
      core.addColorStop(0, rgba(p.hi, 1));
      core.addColorStop(0.55, rgba(p.mark, 0.95));
      core.addColorStop(1, rgba(c, 0.9));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.fill();
    },
  };
}

interface Tendril {
  a: number;
  target: number;
  next: number;
}

/** Plasma ball: lightning tendrils from the electrode to the glass; more and brighter when loud. */
export function plasma(size: number): OrbStyle {
  const tendrils: Tendril[] = Array.from({ length: 8 }, (_, i) => ({
    a: (i / 8) * TAU,
    target: (i / 8) * TAU,
    next: 0,
  }));
  const steps = size >= 150 ? 14 : 7;
  return {
    draw(env) {
      const { ctx, R, e, t, dt, c, alt, p, still } = env;
      const r = R * 0.68;
      glow(ctx, R, R, R, c, 0.12 + e * 0.2);
      ctx.fillStyle = rgba(p.deep, p.light ? 0.15 : 0.6);
      ctx.beginPath();
      ctx.arc(R, R, r, 0, TAU);
      ctx.fill();
      const live = Math.max(3, Math.round(4 + e * 4));
      ctx.save();
      ctx.globalCompositeOperation = additive(env);
      ctx.lineCap = 'round';
      tendrils.slice(0, live).forEach((td, k) => {
        if (!still && t > td.next) {
          td.target = td.a + (Math.random() - 0.5) * 1.6;
          td.next = t + 0.4 + Math.random() * 1.2;
        }
        td.a += (td.target - td.a) * Math.min(1, dt * 3);
        const [ex, ey] = [R + Math.cos(td.a) * r * 0.97, R + Math.sin(td.a) * r * 0.97];
        ctx.beginPath();
        ctx.moveTo(R, R);
        for (let i = 1; i <= steps; i++) {
          const u = i / steps;
          const jitter = (still ? 0 : Math.random() - 0.5) * R * 0.08 * Math.sin(u * Math.PI);
          ctx.lineTo(
            R + (ex - R) * u - Math.sin(td.a) * jitter,
            R + (ey - R) * u + Math.cos(td.a) * jitter,
          );
        }
        ctx.lineWidth = Math.max(1, R * (0.012 + e * 0.012));
        ctx.strokeStyle = rgba(k % 2 ? alt : lerp(c, p.hi, 0.4), 0.55 + e * 0.4);
        ctx.shadowColor = rgba(c, 1);
        ctx.shadowBlur = R * 0.08;
        ctx.stroke();
        glow(ctx, ex, ey, R * 0.1, c, 0.6);
      });
      ctx.restore();
      glow(ctx, R, R, R * 0.14, p.hi, 0.95);
      glassRim(env, r);
    },
  };
}
