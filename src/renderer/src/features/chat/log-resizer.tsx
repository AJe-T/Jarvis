import { useCallback, useState } from 'react';

const WIDTH_KEY = 'jarvis.commsLogWidth';
export const MIN_LOG_WIDTH = 320;
/** The orb keeps at least this much room beside the log. */
const MIN_STAGE_WIDTH = 360;
const STEP = 32;

/** Widest the log may be inside a row of `rowWidth` pixels. */
export function clampLogWidth(width: number, rowWidth: number): number {
  const max = Math.max(MIN_LOG_WIDTH, rowWidth - MIN_STAGE_WIDTH);
  return Math.round(Math.min(max, Math.max(MIN_LOG_WIDTH, width)));
}

export function saved(): number | null {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v >= MIN_LOG_WIDTH ? v : null;
  } catch {
    return null;
  }
}

/** The log's width chosen by dragging (remembered per PC); null = the default width. */
export function useLogWidth(): [number | null, (w: number | null) => void] {
  const [width, setWidth] = useState<number | null>(saved);
  const set = useCallback((w: number | null) => {
    setWidth(w);
    try {
      if (w === null) localStorage.removeItem(WIDTH_KEY);
      else localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // storage off: the width just isn't remembered
    }
  }, []);
  return [width, set];
}

/**
 * Drag handle on the log's left edge. Drag, or focus it and use ←/→ (Home/End for the limits);
 * double-click goes back to the default width.
 */
export function LogResizer({
  width,
  onWidth,
}: {
  width: number | null;
  onWidth(w: number | null): void;
}): React.JSX.Element {
  const rowWidth = (el: Element): number =>
    el.closest('[data-log-row]')?.getBoundingClientRect().width ?? window.innerWidth;
  const current = (el: Element): number =>
    width ?? el.parentElement?.getBoundingClientRect().width ?? MIN_LOG_WIDTH;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize conversation log"
      aria-valuemin={MIN_LOG_WIDTH}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="group absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize touch-none focus-visible:outline-none lg:block"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const right = handle.parentElement?.getBoundingClientRect().right ?? window.innerWidth;
        const row = rowWidth(handle);
        const move = (ev: PointerEvent): void => onWidth(clampLogWidth(right - ev.clientX, row));
        const up = (): void => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      }}
      onDoubleClick={() => onWidth(null)}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        const row = rowWidth(el);
        const now = current(el);
        // The handle is on the left edge, so ← widens the log.
        const next = (
          {
            ArrowLeft: now + STEP,
            ArrowRight: now - STEP,
            Home: MIN_LOG_WIDTH,
            End: row,
          } as Record<string, number | undefined>
        )[e.key];
        if (next === undefined) return;
        e.preventDefault();
        onWidth(clampLogWidth(next, row));
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent-500 group-focus-visible:bg-accent-300 group-active:bg-accent-300"
      />
    </div>
  );
}
