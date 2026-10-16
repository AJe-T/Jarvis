import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { AssistantState } from '@shared/types';
import { DEFAULT_ORB_STYLE, ORB_STYLES, type OrbStyleId } from '@shared/orb-styles';
import { Orb } from '../../components/jarvis/orb';
import { applyTheme, resolveTheme } from '../../components/jarvis/theme-sync';
import { call } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';

const IDLE_FADE_MS = 4000;

/**
 * Design-system.md §4.3 mini mode. The window is only as big as the orb, so the rest of the screen
 * stays clickable. Drag it along the edges; push it past an edge (or use the chevron / right-click)
 * to tuck it away as a slim handle; click the handle to bring it back; click the orb to open Jarvis.
 */
export function MiniOrb(): React.JSX.Element {
  const [state, setState] = useState<AssistantState>('IDLE');
  const mood = useAssistantStore((s) => s.mood);
  const [mic, setMic] = useState(0);
  const [music, setMusic] = useState(0);
  const [caption, setCaption] = useState('');
  const [orbStyle, setOrbStyle] = useState<OrbStyleId>(DEFAULT_ORB_STYLE);
  const [layout, setLayout] = useState<{ side: 'left' | 'right'; tucked: boolean }>({
    side: 'right',
    tucked: false,
  });
  const [awake, setAwake] = useState(true);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The mini window has no settings store: read the theme and accent once when it opens.
  useEffect(() => {
    void call('settings:getAll', {}).then((v) => {
      const light = window.matchMedia('(prefers-color-scheme: light)').matches;
      const theme = resolveTheme(v['appearance.theme'], light);
      const accent = v['appearance.accent'];
      applyTheme(theme, typeof accent === 'string' ? accent : '');
      const style = ORB_STYLES.find((s) => s.id === v['appearance.orbStyle']);
      if (style) setOrbStyle(style.id);
    });
  }, []);

  useEffect(() => {
    const on = window.jarvis.on;
    const subs = [
      on('assistant:state', (p) => {
        setState(p.state);
        if (p.state === 'IDLE' || p.state === 'LISTENING') setTimeout(() => setCaption(''), 4000);
      }),
      on('assistant:mood', (p) => useAssistantStore.getState().setMood(p.mood)),
      on('voice:level', (p) => setMic(p.rms)),
      on('music:level', (p) => setMusic(p.rms)),
      on('chat:delta', (p) =>
        setCaption((c) => (c + p.textDelta).replace(/<\/?spoken>/g, '').slice(-140)),
      ),
      on('chat:message', (p) => {
        if (p.message.role === 'user') setCaption('');
      }),
      on('mini:layout', setLayout),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  // The window widens for the caption bubble only while there is one (and never while tucked).
  const showCaption = !!caption && !layout.tucked;
  useEffect(() => {
    void call('mini:caption', { open: showCaption });
  }, [showCaption]);

  // Idle and untouched: the orb fades back so it does not distract.
  const active = state !== 'IDLE' || !!caption;
  const wake = (): void => {
    setAwake(true);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => setAwake(false), IDLE_FADE_MS);
  };
  useEffect(() => {
    wake();
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [state]);

  /** Main moves the window with the cursor; a press without movement is a click. */
  const press = (onClick: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      void call('mini:dragStart', {});
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      void call('mini:dragEnd', {}).then((r) => !r.moved && onClick());
    },
    // Capture lost without a pointerup (window hidden, focus stolen): stop following the cursor.
    onLostPointerCapture: () => void call('mini:dragEnd', {}),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      void call('mini:menu', {});
    },
  });

  if (layout.tucked) {
    const level = state === 'LISTENING' ? mic : state === 'SPEAKING' ? 0.5 : 0;
    return (
      <button
        type="button"
        aria-label="Bring the Jarvis orb back (drag to move along the edge)"
        title="Click to bring the orb back · drag to move · right-click for options"
        {...press(() => void call('mini:tuck', { tucked: false }))}
        className={clsx(
          // Only the 14px against the screen edge is on screen; draw the handle there.
          'group flex h-screen w-screen items-center bg-transparent',
          layout.side === 'left' ? 'justify-end' : 'justify-start',
        )}
      >
        <span
          className={clsx(
            'flex h-full w-3.5 items-center justify-center border border-accent-edge bg-surface-1/90 text-accent-500 shadow-pop transition-[filter] group-hover:brightness-125',
            layout.side === 'left' ? 'rounded-r-pill border-l-0' : 'rounded-l-pill border-r-0',
            active && 'animate-pulse',
          )}
          style={{ boxShadow: `0 0 ${8 + level * 30}px var(--accent-glow)` }}
        >
          {layout.side === 'left' ? (
            <ChevronRight size={12} aria-hidden />
          ) : (
            <ChevronLeft size={12} aria-hidden />
          )}
        </span>
      </button>
    );
  }

  return (
    <div
      className={clsx(
        'flex h-screen items-center gap-2 transition-opacity duration-500',
        layout.side === 'right' ? 'flex-row justify-end' : 'flex-row-reverse justify-end',
        !awake && !active && 'opacity-60',
      )}
      onPointerEnter={wake}
      onPointerMove={wake}
    >
      {showCaption && (
        <p
          className="fade-in line-clamp-3 max-w-[220px] rounded-lg border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink-100 shadow-pop"
          aria-live="polite"
        >
          {caption}
        </p>
      )}
      <div className="group relative shrink-0">
        <button
          type="button"
          aria-label="Open Jarvis"
          title="Click to open Jarvis · drag to move · push into the edge to tuck away · right-click for options"
          {...press(() => void call('app:setMiniMode', { on: false }))}
          // §5.4: the orb on a small solid disc.
          className="cursor-grab rounded-pill border border-line-strong bg-surface-1 p-1 shadow-pop active:cursor-grabbing"
        >
          <Orb
            state={state}
            level={state === 'LISTENING' ? mic : music}
            size="dock"
            orbStyle={orbStyle}
            mood={mood}
          />
        </button>
        <button
          type="button"
          aria-label="Tuck the orb into the screen edge"
          title="Tuck into the edge"
          onClick={() => void call('mini:tuck', { tucked: true })}
          className={clsx(
            'absolute top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-pill border border-line-strong bg-surface-1 text-ink-300 opacity-0 shadow-pop transition-opacity group-hover:opacity-100 hover:text-accent-500 focus-visible:opacity-100',
            layout.side === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {layout.side === 'right' ? (
            <ChevronRight size={12} aria-hidden />
          ) : (
            <ChevronLeft size={12} aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
