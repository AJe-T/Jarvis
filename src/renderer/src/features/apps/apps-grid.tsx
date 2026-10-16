import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Calculator,
  CalendarCheck,
  Camera,
  Clock3,
  Cpu,
  Globe,
  Globe2,
  NotebookPen,
  QrCode,
  Receipt,
  Ruler,
  SquareTerminal,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { JARVIS_APPS, JARVIS_APP_INFO, type JarvisAppId } from '@shared/jarvis-apps';
import { useStageStore } from '../../stores/stage-store';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { colorOf } from '../brain/brain-layout';
import { bubbleScale, hexSpiral, type HexSpot } from './honeycomb';

/** One icon per app in shared/jarvis-apps.ts (a missing one fails the typecheck). */
export const APP_ICONS: Record<JarvisAppId, LucideIcon> = {
  today: CalendarCheck,
  calculator: Calculator,
  browser: Globe,
  terminal: SquareTerminal,
  camera: Camera,
  timers: Clock3,
  pomodoro: Timer,
  scratchpad: NotebookPen,
  converter: Ruler,
  clock: Globe2,
  qr: QrCode,
  monitor: Cpu,
  usage: Receipt,
  status: Activity,
};

/** Bubble spacing and size in pixels (centre to centre, and diameter). */
const UNIT = 86;
const BUBBLE = 68;

/**
 * Every Jarvis app as a bubble in an Apple Watch style honeycomb (ADR-040): Sidebar → Apps and
 * Core's "All apps" both show it, and each app opens beside the orb. Pressing the open one again
 * closes it. Bubbles shrink toward the edge and swell under the pointer.
 */
export function AppsGrid({ onLaunch }: { onLaunch?(): void }): React.JSX.Element {
  const panel = useStageStore((s) => s.panel);
  const show = useStageStore((s) => s.show);
  const still = useReducedMotion();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState<JarvisAppId | null>(null);
  const spots = useMemo(() => hexSpiral(JARVIS_APPS.length), []);
  const xs = spots.map((s) => s.x);
  const ys = spots.map((s) => s.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = (Math.max(...xs) - minX) * UNIT + BUBBLE * 1.4;
  const height = (Math.max(...ys) - minY) * UNIT + BUBBLE * 1.4;
  const open = (id: JarvisAppId): boolean => panel?.kind === JARVIS_APP_INFO[id].panel.kind;
  const caption = focused ? JARVIS_APP_INFO[focused] : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <ul
        aria-label="Apps"
        className="relative shrink-0"
        style={{ width, height }}
        onPointerMove={(e) => {
          if (still) return;
          const r = e.currentTarget.getBoundingClientRect();
          setPointer({
            x: (e.clientX - r.left - BUBBLE * 0.7) / UNIT + minX,
            y: (e.clientY - r.top - BUBBLE * 0.7) / UNIT + minY,
          });
        }}
        onPointerLeave={() => setPointer(null)}
      >
        {JARVIS_APPS.map((id, i) => {
          const spot = spots[i] as HexSpot;
          const Icon = APP_ICONS[id];
          const info = JARVIS_APP_INFO[id];
          const on = open(id);
          const col = colorOf(id);
          const scale = bubbleScale(spot, focused === id ? spot : pointer);
          return (
            <li
              key={id}
              className="absolute"
              style={{
                left: (spot.x - minX) * UNIT + BUBBLE * 0.2,
                top: (spot.y - minY) * UNIT + BUBBLE * 0.2,
                width: BUBBLE,
                height: BUBBLE,
              }}
            >
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${info.label}: ${info.blurb}`}
                title={info.label}
                onClick={() => {
                  onLaunch?.();
                  show(on ? null : info.panel);
                }}
                onFocus={() => setFocused(id)}
                onBlur={() => setFocused(null)}
                onPointerEnter={() => setFocused(id)}
                onPointerLeave={() => setFocused(null)}
                className={clsx(
                  'grid size-full place-items-center rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
                  !still && 'transition-transform duration-200 ease-out',
                )}
                style={{
                  transform: `scale(${scale.toFixed(3)})`,
                  borderColor: on
                    ? 'var(--accent-600)'
                    : `color-mix(in srgb, ${col} 55%, transparent)`,
                  background: `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${col} 45%, var(--surface-1)), color-mix(in srgb, ${col} 14%, var(--surface-1)) 72%)`,
                  boxShadow: on
                    ? '0 0 0 3px var(--accent-glow), 0 0 22px var(--accent-glow)'
                    : `0 6px 18px color-mix(in srgb, ${col} 22%, transparent)`,
                  color: 'var(--ink-100)',
                }}
              >
                <Icon size={26} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="h-10 text-center text-sm">
        {caption ? (
          <>
            <span className="block font-semibold text-ink-100">{caption.label}</span>
            <span className="text-xs text-ink-500">{caption.blurb}</span>
          </>
        ) : (
          <span className="text-xs text-ink-500">Point at an app to see what it does.</span>
        )}
      </p>
    </div>
  );
}
