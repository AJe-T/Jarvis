import type { AssistantState } from '@shared/types';
import { DEFAULT_ORB_STYLE, type OrbStyleId } from '@shared/orb-styles';
import {
  HUD_MIN_PX,
  TAU,
  moodFor,
  moodGain,
  readPalette,
  segmentColour,
  toneFor,
  type Env,
  type OrbFrame,
} from './orb-kit';
import { ORB_STYLE_FACTORIES } from './orb-styles';

export type { OrbFrame, OrbStep } from './orb-kit';

function spinRate(state: AssistantState, energy: number): number {
  if (state === 'THINKING') return 1.6;
  if (state === 'LISTENING') return 0.8;
  return 0.25 + energy * 1.1;
}

/**
 * Drives one orb canvas (Design-system.md §6.1). The shared part follows the level: `energy` has a
 * fast attack and slow release so the orb jumps with speech or a beat and settles smoothly; at
 * rest it breathes. The chosen style paints; styles that don't show tool progress themselves get
 * a thin segmented ring while ACTING. `demo` (style previews) feeds a made-up level.
 */
export function createOrbPainter(
  ctx: CanvasRenderingContext2D,
  size: number,
  styleId: OrbStyleId = DEFAULT_ORB_STYLE,
  demo = false,
) {
  const style = (ORB_STYLE_FACTORIES[styleId] ?? ORB_STYLE_FACTORIES[DEFAULT_ORB_STYLE])(size);
  let palette = readPalette();
  let energy = 0;
  let spin = 0;
  let lastT = 0;
  let frame = 0;
  const R = size / 2;

  return function draw(f: OrbFrame, t: number, still: boolean): void {
    const dt = lastT ? Math.min(0.05, t - lastT) : 0.016;
    lastT = t;
    if (frame++ % 30 === 0) palette = readPalette(); // follows theme and accent switches
    const asleep = f.state === 'SLEEP';
    const level = demo ? 0.05 + 0.08 * Math.abs(Math.sin(t * 2.3) * Math.sin(t * 0.7)) : f.level;
    const breathe = still || asleep ? 0 : 0.06 + 0.04 * Math.sin(t * 1.3);
    const gain = moodGain(f);
    const target = still || asleep ? 0 : Math.max(breathe, Math.min(1, level * 4 * gain));
    energy += (target - energy) * (target > energy ? 0.45 : 0.08);
    if (!still) spin += dt * spinRate(f.state, energy) * gain;

    const env: Env = {
      ctx,
      size,
      R,
      t,
      dt,
      e: energy,
      spin,
      still,
      p: palette,
      c: toneFor(f.state, palette, moodFor(f)),
      alt: f.state === 'ERROR' ? palette.alarm : palette.alt,
      f,
      hud: size >= HUD_MIN_PX,
    };
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.globalAlpha = asleep ? 0.4 : 1;
    // ERROR: the whole orb jitters sideways (a glitch), never under reduced motion.
    if (!still && f.state === 'ERROR') ctx.translate((Math.random() - 0.5) * R * 0.05, 0);
    ctx.save();
    style.draw(env);
    ctx.restore();
    if (!style.ownsSteps && f.state === 'ACTING' && f.steps.length) {
      const n = Math.max(12, f.steps.length * 6);
      ctx.lineWidth = Math.max(2, R * 0.025);
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = segmentColour(env, i, n);
        ctx.beginPath();
        ctx.arc(R, R, R * 0.95, (i / n) * TAU + 0.02, ((i + 1) / n) * TAU - 0.02);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
}
