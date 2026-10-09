import type { CalEvent, Calendar, Todo } from '@shared/planner';
import {
  addDays,
  addMinutes,
  minutesBetween,
  occurrencesBetween,
  startOfWeek,
} from '@shared/planner-time';

/** Pure helpers for the Calendar view: what to draw where. */

export interface CalItem {
  key: string;
  kind: 'event' | 'task';
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  /** Occurrence date (what "delete this one" names). */
  date: string;
  location: string;
  repeats: boolean;
  done: boolean;
}

export function buildItems(
  events: CalEvent[],
  calendars: Calendar[],
  todos: Todo[],
  from: string,
  to: string,
  opts: { showTasks: boolean; query: string },
): CalItem[] {
  const cals = new Map(calendars.map((c) => [c.id, c]));
  const q = opts.query.trim().toLowerCase();
  const match = (s: string): boolean => !q || s.toLowerCase().includes(q);
  const out: CalItem[] = [];
  for (const e of events) {
    const cal = cals.get(e.calendarId);
    if (!cal?.visible || !(match(e.title) || match(e.location) || match(e.notes))) continue;
    for (const o of occurrencesBetween(e, `${from}T00:00`, `${to}T23:59`))
      out.push({
        key: `${e.id}:${o.date}`,
        kind: 'event',
        id: e.id,
        title: e.title,
        start: o.start,
        end: o.end,
        allDay: e.allDay,
        color: cal.color,
        date: o.date,
        location: e.location,
        repeats: !!e.recurrence,
        done: false,
      });
  }
  if (opts.showTasks)
    for (const t of todos) {
      if (!t.dueDate || t.parentId || t.dueDate < from || t.dueDate > to || !match(t.title))
        continue;
      const start = `${t.dueDate}T${t.dueTime ?? '00:00'}`;
      out.push({
        key: `task:${t.id}`,
        kind: 'task',
        id: t.id,
        title: t.title,
        start,
        end: t.dueTime ? addMinutes(start, t.durationMin ?? 30) : `${t.dueDate}T23:59`,
        allDay: !t.dueTime,
        color: '#94a3b8',
        date: t.dueDate,
        location: '',
        repeats: !!t.recurrence,
        done: t.status === 'done',
      });
    }
  return out.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) ||
      a.start.localeCompare(b.start) ||
      b.end.localeCompare(a.end),
  );
}

/** Does an item touch this day? */
export const onDay = (it: CalItem, day: string): boolean =>
  it.start.slice(0, 10) <= day &&
  it.end.slice(0, 10) >= day &&
  !(it.end === `${day}T00:00` && it.start < it.end);

/** The 6×7 dates shown for a month (weeks start on Monday). */
export function monthGrid(anyDayInMonth: string): string[] {
  const first = startOfWeek(`${anyDayInMonth.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export interface Placed {
  item: CalItem;
  /** Minutes from the day's midnight, clipped to the day. */
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** Side-by-side columns for overlapping timed items on one day (Google Calendar style). */
export function layoutDay(items: CalItem[], day: string): Placed[] {
  const dayStart = `${day}T00:00`;
  const timed = items
    .filter((it) => !it.allDay && onDay(it, day))
    .map((item) => {
      const s = item.start < dayStart ? dayStart : item.start;
      const top = Math.max(0, minutesBetween(dayStart, s));
      const end = Math.min(1440, minutesBetween(dayStart, item.end));
      return { item, top, height: Math.max(20, end - top), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const finish = (): void => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1));
    for (const p of cluster) p.cols = cols;
    cluster = [];
  };
  for (const p of timed) {
    if (p.top >= clusterEnd) finish();
    const used = new Set(cluster.filter((c) => c.top + c.height > p.top).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.top + p.height);
  }
  finish();
  return timed;
}

/** Snap minutes to a step (15 by default). */
export const snap = (m: number, step = 15): number => Math.round(m / step) * step;

export const stampAt = (day: string, minutes: number): string => {
  const m = Math.max(0, Math.min(1439, minutes));
  return `${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
