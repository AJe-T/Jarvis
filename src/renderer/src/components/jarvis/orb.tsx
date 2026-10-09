import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { AssistantState } from '@shared/types';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { createOrbPainter, type OrbFrame, type OrbStep } from './orb-painter';
import { selectOrbLevel, useAssistantStore } from '../../stores/assistant-store';

export type { OrbStep } from './orb-painter';

const SIZES = { sm: 32, dock: 72, md: 88, lg: 168, xl: 340 } as const;

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
}

/**
 * Design-system.md §6.1 — Jarvis's reactor core: a plasma sphere in a bright ring, a ring of bars
 * that jumps with the level, and a HUD of rotating arcs, ticks and a radar sweep. Drawn on a
 * canvas every frame; under reduced motion it is drawn once per change and does not move.
 */
export function Orb({
  state,
  level = 0,
  size,
  steps = [],
  announce = true,
}: OrbProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const px = SIZES[size];
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<OrbFrame>({ state, level, steps });
  frame.current = { state, level, steps };
  const [announced, setAnnounced] = useState(LABEL[state]);

  // Debounced live-region announcement so fast state flips don't spam screen readers.
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(LABEL[state]), 600);
    return () => clearTimeout(t);
  }, [state]);

  // Reduced motion repaints on each state change; the animated loop reads the latest props itself.
  const stillKey = reduced ? `${state}:${steps.join(',')}` : '';
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(px * dpr);
    el.height = Math.round(px * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = createOrbPainter(ctx, px);
    if (reduced) {
      draw(frame.current, 0, true);
      return;
    }
    let raf = requestAnimationFrame(function tick(now) {
      draw(frame.current, now / 1000, false);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [px, reduced, stillKey]);

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
  return <Orb state={state} level={level} {...props} />;
}
