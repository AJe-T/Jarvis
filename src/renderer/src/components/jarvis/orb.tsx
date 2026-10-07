import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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

/** One segment per tool call while ACTING (§6.1). */
export type OrbStep = 'pending' | 'running' | 'done' | 'error';

export interface OrbProps {
  state: AssistantState;
  level?: number;
  size: keyof typeof SIZES;
  /** Light the backdrop from this orb (§6.1). Off for a hidden orb so the visible one owns the spill. */
  spill?: boolean;
  /** Tool calls of the running turn; drawn as a segmented ring while ACTING. */
  steps?: readonly OrbStep[];
}

/** §6.1: the orb lights the backdrop with its state colour (tokens.css --spill-*). */
const SPILL: Record<AssistantState, string> = {
  IDLE: 'var(--spill-idle)',
  LISTENING: 'var(--spill-active)',
  THINKING: 'var(--spill-think)',
  ACTING: 'var(--spill-active)',
  AWAITING_CONFIRMATION: 'var(--spill-awaiting)',
  SPEAKING: 'var(--spill-active)',
  ERROR: 'var(--spill-error)',
  SLEEP: 'transparent',
};

/** Core energy [centre, rim, glow] per state. The orb is the light source, so it uses the raw
 *  palette in both themes (tokens.css --orb-*). */
function energy(state: AssistantState): [string, string, string] {
  if (state === 'AWAITING_CONFIRMATION')
    return ['var(--orb-amber-core)', 'var(--warning)', 'var(--orb-amber-glow)'];
  if (state === 'ERROR') return ['var(--orb-red-core)', 'var(--error)', 'var(--orb-red-glow)'];
  return ['var(--cyan-200)', 'var(--cyan-400)', 'var(--reactor-glow)'];
}

const STEP_COLOR: Record<OrbStep, string> = {
  pending: 'var(--glass-border-strong)',
  running: 'var(--violet-500)',
  done: 'var(--cyan-400)',
  error: 'var(--error)',
};

/** A few slow motes around the orb (md/lg only); fixed positions so renders are stable. */
const PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + (i % 3) * 0.4;
  const r = 34 + (i % 4) * 3.5;
  return {
    cx: 50 + Math.cos(a) * r,
    cy: 50 + Math.sin(a) * r,
    r: 0.55 + (i % 3) * 0.25,
    violet: i % 3 === 0,
    style: {
      '--p-x': `${Math.cos(a) * 5}px`,
      '--p-y': `${Math.sin(a) * 5 - 4}px`,
      '--p-dur': `${6 + (i % 5)}s`,
      '--p-delay': `${(i * 0.7) % 6}s`,
      '--p-alpha': `${0.35 + (i % 3) * 0.15}`,
    } as React.CSSProperties,
  };
});

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

/** Closed path of a gentle wave around the core; amplitude follows the TTS level. */
function wavePath(level: number, phase: number): string {
  const amp = 1 + Math.min(1, level * 4) * 4.5;
  const pts: string[] = [];
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2;
    const r = 37 + amp * Math.sin(6 * t + phase) * (0.55 + 0.45 * Math.sin(3 * t - phase * 0.7));
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
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${seg} ${c - seg}`}
          strokeDashoffset={-i * (seg + gap)}
          style={{ transition: 'stroke 200ms' }}
        />
      ))}
    </g>
  );
}

/** Design-system.md §6.1 — the multi-layer reactor: the app's signature and its strongest light. */
export function Orb({
  state,
  level = 0,
  size,
  spill = true,
  steps = [],
}: OrbProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const px = SIZES[size];
  const [announced, setAnnounced] = useState(LABEL[state]);
  const spillRef = useReactorSpill(state, spill);

  // Debounced live-region announcement so fast state flips don't spam screen readers.
  useEffect(() => {
    const t = setTimeout(() => setAnnounced(LABEL[state]), 600);
    return () => clearTimeout(t);
  }, [state]);

  const asleep = state === 'SLEEP';
  const motion = !reduced;
  const lvl = Math.min(1, level * 4);
  const coreScale = !motion
    ? 1
    : state === 'LISTENING'
      ? 0.95 + lvl * 0.17
      : state === 'SPEAKING'
        ? 1 + lvl * 0.05
        : 1;
  const [centre, rim, glow] = energy(state);
  const thinking = state === 'THINKING';

  return (
    <div
      ref={spillRef}
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
        overflow="visible"
      >
        <defs>
          <radialGradient id={`glow-${uid}`}>
            <stop offset="0%" stopColor={glow} />
            <stop offset="100%" stopColor={glow} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`core-${uid}`} cx="42%" cy="40%" r="65%">
            <stop offset="0%" stopColor={centre} />
            <stop offset="55%" stopColor={rim} />
            <stop offset="100%" stopColor={rim} stopOpacity="0.35" />
          </radialGradient>
        </defs>

        {/* 1 · ambient glow */}
        {!asleep && (
          <circle
            cx="50"
            cy="50"
            r="50"
            fill={`url(#glow-${uid})`}
            opacity={state === 'IDLE' ? 0.75 : state === 'ERROR' ? 0.6 : 1}
            className={clsx('orb-part', motion && state === 'IDLE' && 'orb-breathe')}
          />
        )}

        {/* 2 · outer transparent ring */}
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="none"
          stroke="var(--cyan-300)"
          strokeOpacity={asleep ? 0.12 : 0.18}
          strokeWidth="0.6"
        />

        {/* 3 · slow orbital ring with one satellite */}
        {!asleep && (
          <g className={clsx('orb-part', motion && 'orb-orbit-slow')}>
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--cyan-300)"
              strokeOpacity="0.32"
              strokeWidth="0.6"
              strokeDasharray="1.5 5"
            />
            <circle cx="92" cy="50" r="1.4" fill="var(--cyan-300)" opacity="0.85" />
          </g>
        )}

        {/* 4 · violet energy ring (thinking turns it), or tool progress while acting */}
        {state === 'ACTING' ? (
          <StepRing steps={steps} />
        ) : (
          !asleep && (
            <g className={clsx('orb-part', motion && thinking && 'orb-orbit')}>
              <circle
                cx="50"
                cy="50"
                r="36"
                fill="none"
                stroke="var(--violet-500)"
                strokeWidth={thinking ? 2.4 : 1.4}
                strokeLinecap="round"
                strokeDasharray={thinking ? '46 18 12 150' : '38 188'}
                opacity={thinking ? 0.95 : state === 'AWAITING_CONFIRMATION' ? 0.25 : 0.55}
              />
            </g>
          )
        )}

        {/* 5 · cyan energy ring; listening ripples out of it, speaking draws a wave */}
        {!asleep && (
          <circle
            cx="50"
            cy="50"
            r="30"
            fill="none"
            stroke={rim}
            strokeWidth="1.2"
            opacity={thinking ? 0.4 : 0.7}
          />
        )}
        {state === 'LISTENING' && motion && (
          <circle
            cx="50"
            cy="50"
            r="30"
            fill="none"
            stroke="var(--cyan-300)"
            strokeWidth="1.5"
            className="orb-part orb-ripple"
            style={{ '--ripple-strength': 0.25 + lvl * 0.6 } as React.CSSProperties}
          />
        )}
        {state === 'SPEAKING' && (
          <path
            d={motion ? wavePath(level, performance.now() / 380) : wavePath(0, 0)}
            fill="none"
            stroke="var(--cyan-300)"
            strokeWidth="1"
            strokeLinejoin="round"
            opacity="0.75"
          />
        )}

        {/* 6 · core  ·  7 · inner highlight */}
        {asleep ? (
          <circle
            cx="50"
            cy="50"
            r="20"
            fill="none"
            stroke="var(--cyan-400)"
            strokeOpacity="0.55"
            strokeWidth="1"
          />
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
              r="20"
              fill={`url(#core-${uid})`}
              opacity={thinking ? 0.78 : 1}
              className="orb-part"
              style={{ transform: `scale(${coreScale})`, transition: 'transform 90ms linear' }}
            />
            <ellipse cx="44.5" cy="43.5" rx="5.5" ry="4" fill="var(--orb-highlight)" />
          </g>
        )}

        {/* 8 · motes (md/lg only, never under reduced motion) */}
        {size !== 'sm' &&
          motion &&
          !asleep &&
          state !== 'ERROR' &&
          PARTICLES.filter((_, i) => thinking || i % 2 === 0).map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r={p.r}
              fill={p.violet ? 'var(--violet-400)' : 'var(--cyan-300)'}
              className="orb-particle"
              style={p.style}
            />
          ))}
      </svg>
      <span className="sr-only" aria-live="polite">
        Jarvis is {announced}
      </span>
    </div>
  );
}
