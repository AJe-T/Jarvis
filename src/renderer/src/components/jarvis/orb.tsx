import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { AssistantState, Mood } from '@shared/types';
import { DEFAULT_ORB_STYLE, type OrbStyleId } from '@shared/orb-styles';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { createOrbPainter, type OrbFrame, type OrbStep } from './orb-painter';
import { selectOrbLevel, useAssistantStore } from '../../stores/assistant-store';
import { useDraftSetting } from '../../stores/settings-store';

export type { OrbStep } from './orb-painter';

const SIZES = { sm: 32, dock: 72, md: 88, lg: 168, xl: 340 } as const;
/** ~30 fps while idle or asleep (a little under 33 ms so a 60 Hz display keeps an even beat). */
const IDLE_FRAME_MS = 30;

const LABEL: Record<AssistantState, string> = {
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  ACTING: 'acting',
  AWAITING_CONFIRMATION: 'waiting for your decision',
  SPEAKING: 'speaking',
  ERROR: 'showing an error',
  SLEEP: 'asleep',
};

export interface OrbProps {
  state: AssistantState;
  /** RMS of what the orb follows: Jarvis's voice, Sir's voice, or music on the PC. */
  level?: number;
  size: keyof typeof SIZES;
  /** Tool calls of the running turn; drawn as segments of the bar ring while ACTING. */
  steps?: readonly OrbStep[];
  /** Announce state changes to screen readers. Only one orb on screen should (the others are copies). */
  announce?: boolean;
  /** Settings → General → Orb style. */
  orbStyle?: OrbStyleId;
  /** Style previews: feed a made-up level so the orb shows how it moves. */
  demo?: boolean;
  /** Draw one still frame (previews that aren't hovered or selected). */
  paused?: boolean;
  /** The feeling of the latest reply: tints the orb and changes how lively it is. */
  mood?: Mood | null;
}

/**
 * Design-system.md §6.1 — Jarvis's orb, in the style Sir picked (orb-styles/). Drawn on a canvas
 * every frame; under reduced motion it is drawn once per change and does not move.
 */
export function Orb({
  state,
  level = 0,
  size,
  steps = [],
  announce = true,
  orbStyle = DEFAULT_ORB_STYLE,
  demo = false,
  paused = false,
  mood = null,
}: OrbProps): React.JSX.Element {
  const reduced = useReducedMotion() || paused;
  const px = SIZES[size];
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<OrbFrame>({ state, level, steps, mood });
  frame.current = { state, level, steps, mood };
  const [announced, setAnnounced] = useState(LABEL[state]);

  // Debounced live-region announcement so fast state flips don't spam screen readers.
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(LABEL[state]), 600);
    return () => clearTimeout(t);
  }, [state]);

  // Reduced motion repaints on each state change; the animated loop reads the latest props itself.
  // Still frames repaint when the state, the steps or the colours change.
  const accent = useDraftSetting('appearance.accent');
  const theme = useDraftSetting('appearance.theme');
  const stillKey = reduced ? `${state}:${steps.join(',')}:${accent}:${theme}:${mood}` : '';
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(px * dpr);
    el.height = Math.round(px * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = createOrbPainter(ctx, px, orbStyle, demo);
    if (reduced) {
      draw(frame.current, 0, true);
      return;
    }
    let last = 0;
    let raf = requestAnimationFrame(function tick(now) {
      raf = requestAnimationFrame(tick);
      // At rest the orb only breathes: half the frames is invisible and halves its CPU.
      const calm = frame.current.state === 'IDLE' || frame.current.state === 'SLEEP';
      if (calm && now - last < IDLE_FRAME_MS) return;
      last = now;
      draw(frame.current, now / 1000, false);
    });
    return () => cancelAnimationFrame(raf);
  }, [px, reduced, stillKey, orbStyle, demo]);

  return (
    <div
      className={clsx('shrink-0', state === 'ERROR' && !reduced && 'orb-error')}
      style={{ width: px, height: px }}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Jarvis is ${LABEL[state]}`}
        data-state={state}
        data-motion={reduced ? 'off' : 'on'}
        style={{ width: px, height: px }}
      />
      {announce && (
        <span className="sr-only" aria-live="polite">
          Jarvis is {announced}
        </span>
      )}
    </div>
  );
}

/** The main window's orb: follows the assistant store, re-rendering only itself on level changes. */
export function LiveOrb(props: Omit<OrbProps, 'state' | 'level'>): React.JSX.Element {
  const state = useAssistantStore((s) => s.state);
  const level = useAssistantStore(selectOrbLevel);
  const orbStyle = useDraftSetting('appearance.orbStyle') ?? DEFAULT_ORB_STYLE;
  const mood = useAssistantStore((s) => s.mood);
  return <Orb state={state} level={level} orbStyle={orbStyle} mood={mood} {...props} />;
}
