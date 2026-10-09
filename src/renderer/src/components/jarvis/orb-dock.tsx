import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { captionOf, STATUS_LINE } from '../../features/chat/caption';
import { useAssistantStore } from '../../stores/assistant-store';
import { useChatStore } from '../../stores/chat-store';
import { useUiStore } from '../../stores/ui-store';
import { LiveOrb } from './orb';

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const DOCK_KEY = 'jarvis.orbDock';
const CORNER: Record<Corner, string> = {
  tl: 'left-5 top-16',
  tr: 'right-5 top-16',
  bl: 'left-5 bottom-12',
  br: 'right-5 bottom-5',
};

function loadDock(): { corner: Corner; tucked: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null') as {
      corner?: Corner;
      tucked?: boolean;
    } | null;
    return {
      corner: v?.corner && v.corner in CORNER ? v.corner : 'br',
      tucked: v?.tucked === true,
    };
  } catch {
    return { corner: 'br', tucked: false };
  }
}

/**
 * Design-system.md §5.6: on every screen but Core the orb floats in a corner, live with Jarvis's
 * state and voice, with his words beside it while he replies. Click returns to Core; drag it to
 * another corner, or tuck it into the edge so nothing behind it is covered.
 */
export function OrbDock(): React.JSX.Element | null {
  const view = useUiStore((s) => s.view);
  const go = useUiStore((s) => s.go);
  const live = useChatStore((s) => s.live);
  const state = useAssistantStore((s) => s.state);
  const [dock, setDock] = useState(loadDock);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(DOCK_KEY, JSON.stringify(dock));
    } catch {
      // not remembered; fine
    }
  }, [dock]);
  if (view === 'chat') return null;
  const caption = live?.text ? captionOf(live.text, 140) : '';
  const left = dock.corner.endsWith('l');

  if (dock.tucked)
    return (
      <button
        type="button"
        aria-label="Show the Jarvis orb"
        title={`Jarvis · ${STATUS_LINE[state]} — click to bring the orb back`}
        onClick={() => setDock((d) => ({ ...d, tucked: false }))}
        className={clsx(
          'absolute z-30 flex h-16 w-3.5 items-center justify-center border border-accent-edge bg-surface-1 text-accent-500 shadow-pop transition-[width] hover:w-5',
          left ? 'left-0 rounded-r-pill border-l-0' : 'right-0 rounded-l-pill border-r-0',
          dock.corner.startsWith('t') ? 'top-16' : 'bottom-12',
          state !== 'IDLE' && 'animate-pulse',
        )}
      >
        {left ? <ChevronRight size={11} aria-hidden /> : <ChevronLeft size={11} aria-hidden />}
      </button>
    );

  return (
    <div
      className={clsx(
        'pointer-events-none absolute z-30 flex items-end gap-3',
        !drag && CORNER[dock.corner],
        left ? 'flex-row-reverse' : 'flex-row',
      )}
      style={drag ? { position: 'fixed', left: drag.x - 40, top: drag.y - 40 } : undefined}
    >
      {caption && !drag && (
        <p aria-hidden className="popover fade-in max-w-[260px] px-3 py-2 text-sm text-ink-100">
          {caption}
        </p>
      )}
      <div className="group pointer-events-auto relative">
        <button
          type="button"
          aria-label="Open Jarvis core"
          title={`Jarvis · ${STATUS_LINE[state]} — drag to another corner`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, y: e.clientY, moved: false };
          }}
          onPointerMove={(e) => {
            const s = start.current;
            if (!s) return;
            if (!s.moved && Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) < 6) return;
            s.moved = true;
            setDrag({ x: e.clientX, y: e.clientY });
          }}
          onPointerUp={(e) => {
            const s = start.current;
            start.current = null;
            setDrag(null);
            if (!s?.moved) return go('chat');
            const corner =
              `${e.clientY < window.innerHeight / 2 ? 't' : 'b'}${e.clientX < window.innerWidth / 2 ? 'l' : 'r'}` as Corner;
            setDock({ corner, tucked: false });
          }}
          className={clsx('orb-dock', drag ? 'cursor-grabbing' : 'cursor-pointer')}
        >
          <LiveOrb size="dock" announce={false} />
        </button>
        <button
          type="button"
          aria-label="Tuck the orb into the edge"
          title="Tuck into the edge"
          onClick={() => setDock((d) => ({ ...d, tucked: true }))}
          className={clsx(
            'absolute top-0 grid size-5 place-items-center rounded-pill border border-line-strong bg-surface-1 text-ink-300 opacity-0 shadow-pop transition-opacity group-hover:opacity-100 hover:text-accent-500 focus-visible:opacity-100',
            left ? '-left-1' : '-right-1',
          )}
        >
          {left ? <ChevronLeft size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        </button>
      </div>
    </div>
  );
}
