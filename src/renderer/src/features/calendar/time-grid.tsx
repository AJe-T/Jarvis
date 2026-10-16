import { useEffect, useRef, useState } from 'react';
import { CheckSquare, Repeat } from 'lucide-react';
import clsx from 'clsx';
import { minutesBetween, parseLocal, toTime } from '@shared/planner-time';
import { layoutDay, onDay, snap, stampAt, type CalItem } from './calendar-layout';

const HOUR_PX = 48;
const px = (minutes: number): number => (minutes / 60) * HOUR_PX;

interface Drag {
  mode: 'create' | 'move' | 'resize';
  item: CalItem | null;
  dayIndex: number;
  /** create: anchor minute; move: pointer offset inside the item; resize: item top. */
  anchor: number;
  length: number;
  moved: boolean;
  x0: number;
  y0: number;
}
interface Ghost {
  dayIndex: number;
  top: number;
  height: number;
  item: CalItem | null;
}

/** Week and day views: drag on empty time to create, drag an event to move it, drag its edge to resize. */
export function TimeGrid({
  days,
  items,
  today,
  onOpen,
  onCreate,
  onChange,
  onPickDay,
}: {
  days: string[];
  items: CalItem[];
  today: string;
  onOpen: (item: CalItem) => void;
  onCreate: (start: string, end: string, allDay: boolean) => void;
  onChange: (item: CalItem, start: string, end: string) => void;
  onPickDay: (day: string) => void;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: px(7 * 60) });
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const at = (e: React.PointerEvent): { dayIndex: number; minute: number } => {
    const r = colsRef.current?.getBoundingClientRect();
    if (!r) return { dayIndex: 0, minute: 0 };
    const dayIndex = Math.max(
      0,
      Math.min(days.length - 1, Math.floor(((e.clientX - r.left) / r.width) * days.length)),
    );
    return { dayIndex, minute: ((e.clientY - r.top) / HOUR_PX) * 60 };
  };

  function down(
    e: React.PointerEvent,
    mode: Drag['mode'],
    item: CalItem | null,
    top = 0,
    length = 60,
  ): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    drag.current = {
      mode,
      item,
      dayIndex: p.dayIndex,
      anchor: mode === 'create' ? snap(p.minute) : mode === 'move' ? p.minute - top : top,
      length,
      moved: false,
      x0: e.clientX,
      y0: e.clientY,
    };
  }

  function move(e: React.PointerEvent): void {
    const d = drag.current;
    if (!d) return;
    // A few pixels of jitter is still a click.
    if (!d.moved && Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 5) return;
    const p = at(e);
    d.moved = true;
    if (d.mode === 'create') {
      const m = snap(p.minute);
      const top = Math.min(d.anchor, m);
      setGhost({
        dayIndex: d.dayIndex,
        top,
        height: Math.max(15, Math.abs(m - d.anchor)),
        item: null,
      });
    } else if (d.mode === 'move') {
      const top = Math.max(0, Math.min(1440 - 15, snap(p.minute - d.anchor)));
      setGhost({ dayIndex: p.dayIndex, top, height: d.length, item: d.item });
    } else {
      setGhost({
        dayIndex: d.dayIndex,
        top: d.anchor,
        height: Math.max(15, snap(p.minute) - d.anchor),
        item: d.item,
      });
    }
  }

  function up(): void {
    const d = drag.current;
    drag.current = null;
    const g = ghost;
    setGhost(null);
    if (!d) return;
    if (!d.moved || !g) {
      if (d.mode === 'create') {
        const day = days[d.dayIndex] ?? today;
        onCreate(stampAt(day, d.anchor), stampAt(day, d.anchor + 60), false);
      } else if (d.item) onOpen(d.item);
      return;
    }
    const day = days[g.dayIndex] ?? today;
    if (d.mode === 'create') onCreate(stampAt(day, g.top), stampAt(day, g.top + g.height), false);
    else if (d.item)
      onChange(d.item, stampAt(day, g.top), stampAt(day, Math.min(1439, g.top + g.height)));
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const allDay = (day: string): CalItem[] => items.filter((it) => it.allDay && onDay(it, day));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid shrink-0 [scrollbar-gutter:stable] overflow-y-hidden border-b border-line-subtle"
        style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}
      >
        <div />
        {days.map((d) => {
          const date = parseLocal(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPickDay(d)}
              className="flex flex-col items-center py-1.5 hover:bg-hover"
            >
              <span
                className={clsx(
                  'text-2xs font-medium tracking-widest uppercase',
                  d === today ? 'text-accent-500' : 'text-ink-500',
                )}
              >
                {date.toLocaleDateString('en-GB', { weekday: 'short' })}
              </span>
              <span
                className={clsx(
                  'grid size-8 place-items-center rounded-pill text-lg',
                  d === today ? 'bg-accent-600 font-semibold text-ink-on-accent' : 'text-ink-100',
                )}
              >
                {date.getDate()}
              </span>
            </button>
          );
        })}
        <div className="border-t border-line-subtle py-1 pr-2 text-right text-3xs text-ink-500">
          all-day
        </div>
        {days.map((d) => (
          <div
            key={d}
            className="flex min-h-7 flex-col gap-0.5 border-t border-l border-line-subtle p-0.5"
            onDoubleClick={() => onCreate(`${d}T00:00`, `${d}T23:59`, true)}
          >
            {allDay(d).map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => onOpen(it)}
                className={clsx(
                  'flex items-center gap-1 truncate rounded-xs px-1.5 text-left text-xs font-medium',
                  it.done && 'line-through opacity-60',
                )}
                style={{
                  background: `${it.color}33`,
                  color: 'var(--ink-100)',
                  borderLeft: `3px solid ${it.color}`,
                }}
              >
                {it.kind === 'task' && <CheckSquare size={10} aria-hidden />}
                {it.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 [scrollbar-gutter:stable] overflow-y-auto"
      >
        <div className="grid" style={{ gridTemplateColumns: `56px 1fr`, height: px(1440) }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-code text-3xs text-ink-500"
                style={{ top: px(h * 60) }}
              >
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </span>
            ))}
          </div>
          <div
            ref={colsRef}
            className="relative grid select-none"
            style={{
              gridTemplateColumns: `repeat(${days.length}, 1fr)`,
              backgroundImage: `repeating-linear-gradient(to bottom, var(--line-subtle) 0 1px, transparent 1px ${HOUR_PX / 2}px, color-mix(in srgb, var(--line-subtle) 45%, transparent) ${HOUR_PX / 2}px ${HOUR_PX / 2 + 1}px, transparent ${HOUR_PX / 2 + 1}px ${HOUR_PX}px)`,
            }}
            onPointerMove={move}
            onPointerUp={up}
          >
            {days.map((d, di) => (
              <div
                key={d}
                className={clsx(
                  'relative border-l border-line-subtle',
                  d === today && 'bg-accent-tint/40',
                )}
                onPointerDown={(e) => down(e, 'create', null)}
                aria-label={`${d} time slots`}
              >
                {layoutDay(items, d).map((p) => {
                  const it = p.item;
                  const dragging = ghost?.item?.key === it.key;
                  return (
                    <div
                      key={it.key}
                      role="button"
                      tabIndex={0}
                      aria-label={`${it.title}, ${it.start.slice(11)} to ${it.end.slice(11)}`}
                      onKeyDown={(e) => e.key === 'Enter' && onOpen(it)}
                      onPointerDown={(e) => down(e, 'move', it, p.top, p.height)}
                      className={clsx(
                        'group absolute overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5 text-xs leading-tight shadow-sm transition-opacity',
                        dragging && 'opacity-30',
                        it.done && 'line-through opacity-60',
                      )}
                      style={{
                        top: px(p.top),
                        height: px(p.height) - 2,
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        background: `color-mix(in srgb, ${it.color} 22%, var(--surface-1))`,
                        borderColor: it.color,
                        color: 'var(--ink-100)',
                      }}
                    >
                      <p className="flex items-center gap-1 truncate font-semibold">
                        {it.kind === 'task' && <CheckSquare size={10} aria-hidden />}
                        {it.title}
                        {it.repeats && (
                          <Repeat size={9} aria-hidden className="shrink-0 opacity-60" />
                        )}
                      </p>
                      {p.height >= 40 && (
                        <p className="truncate text-ink-300">
                          {it.start.slice(11)}–{it.end.slice(11)}
                          {it.location && ` · ${it.location}`}
                        </p>
                      )}
                      <span
                        aria-hidden
                        onPointerDown={(e) => down(e, 'resize', it, p.top, p.height)}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100"
                        style={{ background: it.color }}
                      />
                    </div>
                  );
                })}
                {ghost && ghost.dayIndex === di && (
                  <div
                    className="pointer-events-none absolute inset-x-1 rounded-sm border border-dashed border-accent-500 bg-accent-tint px-1.5 text-xs text-accent-tag-ink"
                    style={{ top: px(ghost.top), height: px(ghost.height) }}
                  >
                    {ghost.item?.title ?? 'New event'} · {stampAt(d, ghost.top).slice(11)}–
                    {stampAt(d, Math.min(1439, ghost.top + ghost.height)).slice(11)}
                  </div>
                )}
                {d === today && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: px(nowMin) }}
                    aria-label={`Now ${toTime(now)}`}
                  >
                    <span className="-ml-1 size-2.5 rounded-pill bg-alarm-500" />
                    <span className="h-0.5 flex-1 bg-alarm-500" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Minutes an item lasts (for moves that keep the length). */
export const lengthOf = (it: CalItem): number => Math.max(15, minutesBetween(it.start, it.end));
