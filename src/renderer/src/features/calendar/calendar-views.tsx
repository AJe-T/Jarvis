import { useState } from 'react';
import { CheckSquare, ChevronLeft, ChevronRight, MapPin, Repeat } from 'lucide-react';
import clsx from 'clsx';
import { addDays, addMinutes, parseLocal } from '@shared/planner-time';
import { IconButton } from '../../components/ui/button';
import { dayLabel } from '../tasks/task-filters';
import { lengthOf } from './time-grid';
import { monthGrid, onDay, type CalItem } from './calendar-layout';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;

/** Month grid: drag a chip to another day to move it; click a day's empty space to add. */
export function MonthView({
  cursor,
  items,
  today,
  onOpen,
  onCreate,
  onChange,
  onPickDay,
}: {
  cursor: string;
  items: CalItem[];
  today: string;
  onOpen: (it: CalItem) => void;
  onCreate: (start: string, end: string, allDay: boolean) => void;
  onChange: (it: CalItem, start: string, end: string) => void;
  onPickDay: (day: string) => void;
}): React.JSX.Element {
  const [over, setOver] = useState<string | null>(null);
  const days = monthGrid(cursor);
  const month = cursor.slice(0, 7);
  const byKey = new Map(items.map((i) => [i.key, i]));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line-subtle">
        {WEEK.map((d) => (
          <div
            key={d}
            className="py-1.5 text-center text-2xs font-medium tracking-widest text-ink-500 uppercase"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const list = items.filter((it) => onDay(it, d));
          const date = parseLocal(d);
          return (
            <div
              key={d}
              onClick={(e) =>
                e.target === e.currentTarget && onCreate(`${d}T09:00`, `${d}T10:00`, false)
              }
              onDragOver={(e) => {
                e.preventDefault();
                setOver(d);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const it = byKey.get(e.dataTransfer.getData('text/plain'));
                if (!it || it.start.slice(0, 10) === d) return;
                const start = `${d}${it.start.slice(10)}`;
                const len = it.allDay ? 0 : lengthOf(it);
                const end = it.allDay
                  ? `${addDays(d, Math.round((parseLocal(it.end.slice(0, 10)).getTime() - parseLocal(it.start.slice(0, 10)).getTime()) / 86_400_000))}T23:59`
                  : addMinutes(start, len);
                onChange(it, start, end);
              }}
              className={clsx(
                'flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-r border-b border-line-subtle p-1 transition-colors',
                d.slice(0, 7) !== month && 'bg-surface-2/40',
                over === d && 'bg-accent-tint',
              )}
            >
              <button
                type="button"
                onClick={() => onPickDay(d)}
                className={clsx(
                  'grid size-6 shrink-0 place-items-center self-start rounded-pill text-xs',
                  d === today
                    ? 'bg-accent-600 font-semibold text-ink-on-accent'
                    : d.slice(0, 7) === month
                      ? 'text-ink-100 hover:bg-hover'
                      : 'text-ink-500 hover:bg-hover',
                )}
                aria-label={dayLabel(d, today)}
              >
                {date.getDate()}
              </button>
              {list.slice(0, MAX_CHIPS).map((it) => (
                <button
                  key={it.key}
                  type="button"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', it.key)}
                  onClick={() => onOpen(it)}
                  className={clsx(
                    'flex min-w-0 items-center gap-1 rounded-xs px-1 text-left text-2xs leading-5 hover:brightness-110',
                    it.done && 'line-through opacity-60',
                  )}
                  style={
                    it.allDay
                      ? { background: `${it.color}40`, color: 'var(--ink-100)' }
                      : { color: 'var(--ink-100)' }
                  }
                >
                  {it.kind === 'task' ? (
                    <CheckSquare size={10} aria-hidden className="shrink-0" />
                  ) : (
                    !it.allDay && (
                      <span
                        className="size-1.5 shrink-0 rounded-pill"
                        style={{ background: it.color }}
                      />
                    )
                  )}
                  {!it.allDay && (
                    <span className="shrink-0 text-ink-500">{it.start.slice(11)}</span>
                  )}
                  <span className="truncate">{it.title}</span>
                </button>
              ))}
              {list.length > MAX_CHIPS && (
                <button
                  type="button"
                  onClick={() => onPickDay(d)}
                  className="px-1 text-left text-2xs text-ink-500 hover:text-ink-100"
                >
                  +{list.length - MAX_CHIPS} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Schedule list: the coming days that have something on. */
export function AgendaView({
  from,
  days,
  items,
  today,
  onOpen,
}: {
  from: string;
  days: number;
  items: CalItem[];
  today: string;
  onOpen: (it: CalItem) => void;
}): React.JSX.Element {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i)).filter((d) =>
    items.some((it) => onDay(it, d)),
  );
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6">
      {dates.length === 0 && (
        <p className="py-16 text-center text-sm text-ink-500">
          Nothing scheduled in the next {days} days.
        </p>
      )}
      {dates.map((d) => (
        <section key={d} className="mb-4 grid grid-cols-[96px_1fr] gap-3">
          <div className={clsx('pt-1.5', d === today ? 'text-accent-500' : 'text-ink-300')}>
            <p className="text-2xl leading-none font-semibold">{parseLocal(d).getDate()}</p>
            <p className="text-xs tracking-wide uppercase">{dayLabel(d, today)}</p>
          </div>
          <ul className="flex flex-col gap-1">
            {items
              .filter((it) => onDay(it, d))
              .map((it) => (
                <li key={it.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(it)}
                    className="inset flex w-full items-center gap-3 px-3 py-2 text-left"
                  >
                    <span
                      className="h-8 w-1 shrink-0 rounded-pill"
                      style={{ background: it.color }}
                    />
                    <span className="w-24 shrink-0 font-code text-xs text-ink-300">
                      {it.allDay ? 'All day' : `${it.start.slice(11)}–${it.end.slice(11)}`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          'flex items-center gap-1.5 truncate text-sm text-ink-100',
                          it.done && 'line-through opacity-60',
                        )}
                      >
                        {it.kind === 'task' && <CheckSquare size={12} aria-hidden />}
                        {it.title}
                        {it.repeats && <Repeat size={11} aria-hidden className="text-ink-500" />}
                      </span>
                      {it.location && (
                        <span className="flex items-center gap-1 truncate text-xs text-ink-500">
                          <MapPin size={10} aria-hidden /> {it.location}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Small month used by the sidebar and the year view; busy days get a dot. */
export function MiniMonth({
  month,
  selected,
  today,
  busy,
  onPick,
  onMonth,
  compact,
}: {
  month: string;
  selected: string[];
  today: string;
  busy: Map<string, number>;
  onPick: (day: string) => void;
  onMonth?: (delta: number) => void;
  compact?: boolean;
}): React.JSX.Element {
  const days = monthGrid(month);
  const title = parseLocal(`${month.slice(0, 7)}-01`).toLocaleDateString('en-GB', {
    month: 'long',
    ...(compact ? {} : { year: 'numeric' }),
  });
  return (
    <div className="select-none">
      <div className="mb-1 flex items-center">
        <span className="text-sm font-semibold text-ink-100">{title}</span>
        {onMonth && (
          <span className="ml-auto flex">
            <IconButton label="Previous month" className="size-6" onClick={() => onMonth(-1)}>
              <ChevronLeft size={14} aria-hidden />
            </IconButton>
            <IconButton label="Next month" className="size-6" onClick={() => onMonth(1)}>
              <ChevronRight size={14} aria-hidden />
            </IconButton>
          </span>
        )}
      </div>
      <div className="grid grid-cols-7 text-center text-3xs text-ink-500">
        {WEEK.map((d) => (
          <span key={d}>{d[0]}</span>
        ))}
        {days.map((d) => {
          const n = busy.get(d) ?? 0;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-label={`${dayLabel(d, today)}${n ? `, ${n} items` : ''}`}
              className={clsx(
                'relative mx-auto grid size-6 place-items-center rounded-pill text-2xs transition-colors',
                d === today
                  ? 'bg-accent-600 font-semibold text-ink-on-accent'
                  : selected.includes(d)
                    ? 'bg-selected text-ink-100'
                    : d.slice(0, 7) === month.slice(0, 7)
                      ? 'text-ink-300 hover:bg-hover'
                      : 'text-ink-500/50 hover:bg-hover',
              )}
            >
              {parseLocal(d).getDate()}
              {n > 0 && d !== today && (
                <span
                  className="absolute bottom-0.5 size-1 rounded-pill bg-accent-500"
                  style={{ opacity: Math.min(1, 0.35 + n * 0.2) }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Twelve months at a glance; busier days glow brighter. */
export function YearView({
  year,
  today,
  busy,
  onPick,
}: {
  year: number;
  today: string;
  busy: Map<string, number>;
  onPick: (day: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-6 p-6 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => {
        const month = `${year}-${String(m + 1).padStart(2, '0')}-01`;
        return (
          <div key={month} className="card p-3">
            <MiniMonth
              month={month}
              selected={[]}
              today={today}
              busy={busy}
              onPick={onPick}
              compact
            />
          </div>
        );
      })}
    </div>
  );
}
