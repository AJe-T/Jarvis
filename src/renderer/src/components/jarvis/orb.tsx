import { useEffect, useState } from 'react';
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
}

function coreColor(state: AssistantState): string {
  if (state === 'AWAITING_CONFIRMATION') return 'var(--lamp-400)';
  if (state === 'ERROR') return 'var(--alarm-500)';
  if (state === 'SLEEP') return 'transparent';
  return 'var(--reactor-500)';
}

/** Design-system.md §5.1 — the reactor orb, the app's one animated element. */
export function Orb({ state, level = 0, size }: OrbProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const px = SIZES[size];
  const audioDriven = state === 'LISTENING' || state === 'SPEAKING';
  const scale = audioDriven && !reduced ? 0.9 + Math.min(1, level * 4) * 0.25 : 1;
  const [announced, setAnnounced] = useState(LABEL[state]);

  // Debounced live-region announcement so fast state flips don't spam screen readers.
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(LABEL[state]), 600);
    return () => clearTimeout(t);
  }, [state]);

  const coreClass =
    state === 'IDLE' ? 'orb-breathe' : state === 'AWAITING_CONFIRMATION' ? 'orb-pulse' : '';
  return (
    <div className={state === 'ERROR' ? 'orb-shake' : ''} style={{ width: px, height: px }}>
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
