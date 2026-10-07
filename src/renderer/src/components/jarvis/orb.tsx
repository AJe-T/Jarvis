import { useEffect, useId, useState } from 'react';
import clsx from 'clsx';
import type { AssistantState } from '@shared/types';
import { useReducedMotion } from '../../lib/use-reduced-motion';

const SIZES = { sm: 32, md: 88, lg: 112 } as const;

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

/** One segment per tool call while ACTING (§6.1). */
export type OrbStep = 'pending' | 'running' | 'done' | 'error';

export interface OrbProps {
  state: AssistantState;
  level?: number;
  size: keyof typeof SIZES;
  /** Tool calls of the running turn; drawn as a segmented ring while ACTING. */
  steps?: readonly OrbStep[];
}

/** One colour per state: blue normally, amber when Sir must decide, red on error. */
function tone(state: AssistantState): string {
  if (state === 'AWAITING_CONFIRMATION') return 'var(--lamp-400)';
  if (state === 'ERROR') return 'var(--alarm-500)';
  return 'var(--accent-500)';
}

const STEP_COLOR: Record<OrbStep, string> = {
  pending: 'var(--line-strong)',
  running: 'var(--accent-edge)',
  done: 'var(--accent-500)',
  error: 'var(--alarm-500)',
};

/** Closed path of a gentle wave around the core; amplitude follows the TTS level. */
function wavePath(level: number, phase: number): string {
  const amp = 0.8 + Math.min(1, level * 4) * 3.5;
  const pts: string[] = [];
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const r = 36 + amp * Math.sin(6 * t + phase) * (0.55 + 0.45 * Math.sin(3 * t - phase * 0.7));
    pts.push(`${(50 + Math.cos(t) * r).toFixed(2)},${(50 + Math.sin(t) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Segmented progress ring: one arc per tool call, lit as each one runs and finishes. */
function StepRing({ steps }: { steps: readonly OrbStep[] }): React.JSX.Element {
  const r = 36;
  const c = 2 * Math.PI * r;
  const shown: readonly OrbStep[] = steps.length ? steps : ['running'];
  const gap = shown.length > 1 ? 4 : 0;
  const seg = c / shown.length - gap;
  return (
    <g transform="rotate(-90 50 50)">
      {shown.map((s, i) => (
        <circle
          key={i}
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={STEP_COLOR[s]}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${seg} ${c - seg}`}
          strokeDashoffset={-i * (seg + gap)}
          style={{ transition: 'stroke 180ms' }}
        />
      ))}
    </g>
  );
}

/** Design-system.md §6.1 — Jarvis's status mark: a calm core and one ring that shows the state. */
export function Orb({ state, level = 0, size, steps = [] }: OrbProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const px = SIZES[size];
  const [announced, setAnnounced] = useState(LABEL[state]);

  // Debounced live-region announcement so fast state flips don't spam screen readers.
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(LABEL[state]), 600);
    return () => clearTimeout(t);
  }, [state]);

  const motion = !reduced;
  const asleep = state === 'SLEEP';
  const lvl = Math.min(1, level * 4);
  const coreScale = !motion
    ? 1
    : state === 'LISTENING'
      ? 0.94 + lvl * 0.14
      : state === 'SPEAKING'
        ? 1 + lvl * 0.04
        : 1;
  const c = tone(state);
  const active = state !== 'IDLE' && !asleep;

  return (
    <div
      className={clsx('shrink-0', state === 'ERROR' && motion && 'orb-error')}
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
          <radialGradient id={`glow-${uid}`}>
            <stop offset="35%" stopColor={c} stopOpacity="0.22" />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* soft glow, only while Jarvis is doing something */}
        {active && <circle cx="50" cy="50" r="50" fill={`url(#glow-${uid})`} />}

        {/* track */}
        <circle cx="50" cy="50" r="36" fill="none" stroke="var(--line)" strokeWidth="2" />

        {/* state ring */}
        {state === 'ACTING' ? (
          <StepRing steps={steps} />
        ) : state === 'SPEAKING' ? (
          <path
            d={motion ? wavePath(level, performance.now() / 380) : wavePath(0, 0)}
            fill="none"
            stroke={c}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        ) : (
          !asleep && (
            <g className={clsx('orb-part', motion && state === 'THINKING' && 'orb-orbit')}>
              <circle
                cx="50"
                cy="50"
                r="36"
                fill="none"
                stroke={c}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={
                  state === 'IDLE' ? '0 226' : state === 'THINKING' ? '60 166' : '226 0'
                }
                opacity={state === 'IDLE' ? 0 : state === 'LISTENING' ? 0.5 + lvl * 0.5 : 1}
                style={{ transition: 'stroke-dasharray 300ms, opacity 120ms' }}
              />
            </g>
          )
        )}
        {state === 'LISTENING' && motion && (
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke={c}
            strokeWidth="1.5"
            className="orb-part orb-ripple"
            style={{ '--ripple-strength': 0.2 + lvl * 0.5 } as React.CSSProperties}
          />
        )}

        {/* core */}
        {asleep ? (
          <circle cx="50" cy="50" r="22" fill="none" stroke="var(--ink-500)" strokeWidth="2" />
        ) : (
          <g
            className={clsx(
              'orb-part',
              motion && state === 'IDLE' && 'orb-breathe',
              motion && state === 'AWAITING_CONFIRMATION' && 'orb-await',
            )}
          >
            <circle
              cx="50"
              cy="50"
              r="22"
              fill={c}
              opacity={state === 'THINKING' ? 0.85 : 1}
              className="orb-part"
              style={{ transform: `scale(${coreScale})`, transition: 'transform 90ms linear' }}
            />
            <circle cx="50" cy="50" r="9" fill="var(--ink-on-accent)" opacity="0.9" />
          </g>
        )}
      </svg>
      <span className="sr-only" aria-live="polite">
        Jarvis is {announced}
      </span>
    </div>
  );
}
