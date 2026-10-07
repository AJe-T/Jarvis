import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { AssistantState } from '@shared/types';
import { useReducedMotion } from '../../lib/use-reduced-motion';

const SIZES = { sm: 40, md: 96, lg: 160 } as const;

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
  level?: number;
  size: keyof typeof SIZES;
  /** Light the backdrop from this orb (§6.1). Off for a hidden orb so the visible one owns the spill. */
  spill?: boolean;
}

/** §6.1: the orb lights the backdrop with its state colour (tokens.css --spill-*). */
const SPILL: Record<AssistantState, string> = {
  IDLE: 'var(--spill-idle)',
  LISTENING: 'var(--spill-active)',
  THINKING: 'var(--spill-busy)',
  ACTING: 'var(--spill-busy)',
  AWAITING_CONFIRMATION: 'var(--spill-awaiting)',
  SPEAKING: 'var(--spill-active)',
  ERROR: 'var(--spill-error)',
  SLEEP: 'transparent',
};

/** Publishes the state colour and the orb's on-screen centre to <html> for the reactor spill. */
function useReactorSpill(
  state: AssistantState,
  on: boolean,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on) document.documentElement.style.setProperty('--spill-color', SPILL[state]);
  }, [state, on]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const place = (): void => {
      const r = el.getBoundingClientRect();
      const root = document.documentElement.style;
      root.setProperty('--spill-x', `${r.left + r.width / 2}px`);
      root.setProperty('--spill-y', `${r.top + r.height / 2}px`);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [on]);
  return ref;
}

function coreColor(state: AssistantState): string {
  if (state === 'AWAITING_CONFIRMATION') return 'var(--lamp-400)';
  if (state === 'ERROR') return 'var(--alarm-500)';
  if (state === 'SLEEP') return 'transparent';
  return 'var(--reactor-500)';
}

/** Design-system.md §5.1 — the reactor orb, the app's one animated element. */
export function Orb({ state, level = 0, size, spill = true }: OrbProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const px = SIZES[size];
  const audioDriven = state === 'LISTENING' || state === 'SPEAKING';
  const scale = audioDriven && !reduced ? 0.9 + Math.min(1, level * 4) * 0.25 : 1;
  const [announced, setAnnounced] = useState(LABEL[state]);
  const spillRef = useReactorSpill(state, spill);

  // Debounced live-region announcement so fast state flips don't spam screen readers.
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(LABEL[state]), 600);
    return () => clearTimeout(t);
  }, [state]);

  const coreClass =
    state === 'IDLE' ? 'orb-breathe' : state === 'AWAITING_CONFIRMATION' ? 'orb-pulse' : '';
  return (
    <div
      ref={spillRef}
      // md/lg sit in a glass lens: hairline ring + top highlight, no fill, no blur (§6.1).
      className={clsx(
        'shrink-0',
        size !== 'sm' &&
          'rounded-pill border border-glass-border-strong shadow-[inset_0_1px_0_var(--glass-highlight)]',
        state === 'ERROR' && 'orb-shake',
      )}
      style={{ width: px, height: px }}
    >
      <svg
        role="img"
        aria-label={`Jarvis is ${LABEL[state]}`}
        viewBox="0 0 100 100"
        width={px}
        height={px}
        data-state={state}
      >
        <defs>
          <radialGradient id={`orb-glow-${size}`}>
            <stop offset="0%" stopColor="var(--reactor-glow)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        {state !== 'SLEEP' && state !== 'ERROR' && (
          <circle cx="50" cy="50" r="49" fill={`url(#orb-glow-${size})`} />
        )}
        {(state === 'LISTENING' || state === 'SPEAKING') && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="var(--reactor-300)"
            strokeWidth={state === 'SPEAKING' ? 1 + Math.min(1, level * 4) * 3 : 1.5}
            opacity={0.7}
            className={state === 'LISTENING' && !reduced ? 'orb-pulse' : ''}
          />
        )}
        {(state === 'THINKING' || state === 'ACTING') && (
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke="var(--reactor-500)"
            strokeWidth="3"
            strokeDasharray={state === 'THINKING' ? '14 8' : '4 6'}
            strokeLinecap="round"
            className={reduced ? '' : 'orb-spin'}
          />
        )}
        <circle
          cx="50"
          cy="50"
          r="22"
          fill={coreColor(state)}
          stroke={state === 'SLEEP' ? 'var(--ink-500)' : 'none'}
          strokeWidth={2}
          opacity={state === 'ERROR' ? 0.9 : state === 'IDLE' ? undefined : 1}
          className={reduced ? '' : coreClass}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: '50% 50%',
            transition: 'transform 80ms linear',
          }}
        />
        {state !== 'SLEEP' && state !== 'ERROR' && state !== 'AWAITING_CONFIRMATION' && (
          <circle
            cx="50"
            cy="50"
            r="9"
            fill="var(--reactor-300)"
            opacity={state === 'IDLE' ? 0.5 : 0.85}
          />
        )}
      </svg>
      <span className="sr-only" aria-live="polite">
        Jarvis is {announced}
      </span>
    </div>
  );
}
