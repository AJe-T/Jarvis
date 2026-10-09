import type { Recurrence } from './planner';

/** Local date/time helpers for Tasks and Calendar (no time zones: wall-clock strings). */

const pad = (n: number): string => String(n).padStart(2, '0');

export const toDateKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toStamp = (d: Date): string => `${toDateKey(d)}T${toTime(d)}`;

/** "2026-10-09" or "2026-10-09T17:30" → a local Date. */
export function parseLocal(s: string): Date {
  const [y = 1970, mo = 1, d = 1] = s.slice(0, 10).split('-').map(Number);
  const [h = 0, mi = 0] = s.length > 10 ? s.slice(11, 16).split(':').map(Number) : [];
  return new Date(y, mo - 1, d, h, mi);
}

export function addDays(dateKey: string, n: number): string {
  const d = parseLocal(dateKey);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function addMinutes(stamp: string, n: number): string {
  return toStamp(new Date(parseLocal(stamp).getTime() + n * 60_000));
}

/** Whole days from one date to another (DST-safe). */
export const daysBetween = (a: string, b: string): number =>
  Math.round(
    (parseLocal(b.slice(0, 10)).getTime() - parseLocal(a.slice(0, 10)).getTime()) / 86_400_000,
  );

/** Moves a stamp by whole days, keeping its wall-clock time. */
export const shiftDays = (stamp: string, n: number): string =>
  `${addDays(stamp.slice(0, 10), n)}${stamp.slice(10)}`;

export const minutesBetween = (a: string, b: string): number =>
  Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 60_000);

/** Monday-based week start (Sir's calendar starts on Monday). */
export function startOfWeek(dateKey: string): string {
  const day = parseLocal(dateKey).getDay();
  return addDays(dateKey, -((day + 6) % 7));
}

export const daysInMonth = (y: number, m0: number): number => new Date(y, m0 + 1, 0).getDate();

const MAX_STEPS = 20_000;

/**
 * Every date a rule produces from `start` (inclusive), in order. Months or years without the day
 * (31 April, 29 February) are skipped, as in RFC 5545. Stops at `until`, `count` or MAX_STEPS.
 */
export function* recurrenceDates(
  start: string,
  rule: Recurrence | null,
  /** Optional hint: dates before this may be skipped (only without `count`, which needs them). */
  from?: string,
): Generator<string> {
  const first = start.slice(0, 10);
  if (!rule) {
    yield first;
    return;
  }
  const s = parseLocal(first);
  const interval = Math.max(1, rule.interval);
  let emitted = 0;
  const done = (key: string): boolean =>
    (rule.until !== undefined && key > rule.until) ||
    (rule.count !== undefined && emitted >= rule.count);

  // Jump close to `from` so an old repeating event stays cheap to expand.
  let firstStep = 0;
  if (from && rule.count === undefined) {
    const f = parseLocal(from.slice(0, 10));
    const units =
      rule.freq === 'daily' || rule.freq === 'weekly'
        ? daysBetween(first, from.slice(0, 10)) / (rule.freq === 'weekly' ? 7 : 1)
        : rule.freq === 'monthly'
          ? (f.getFullYear() - s.getFullYear()) * 12 + f.getMonth() - s.getMonth()
          : f.getFullYear() - s.getFullYear();
    firstStep = Math.max(0, Math.floor(units / interval) - 1);
  }
  for (let step = firstStep; step < firstStep + MAX_STEPS; step++) {
    let batch: string[];
    if (rule.freq === 'daily') batch = [addDays(first, step * interval)];
    else if (rule.freq === 'weekly') {
      const days = rule.byDay?.length ? [...new Set(rule.byDay)] : [s.getDay()];
      const week = addDays(startOfWeek(first), step * interval * 7);
      batch = days
        .map((d) => addDays(week, (d + 6) % 7))
        .filter((k) => k >= first)
        .sort();
    } else if (rule.freq === 'monthly') {
      const m = s.getMonth() + step * interval;
      const y = s.getFullYear() + Math.floor(m / 12);
      batch =
        s.getDate() <= daysInMonth(y, m % 12) ? [toDateKey(new Date(y, m % 12, s.getDate()))] : [];
    } else {
      const y = s.getFullYear() + step * interval;
      batch =
        s.getDate() <= daysInMonth(y, s.getMonth())
          ? [toDateKey(new Date(y, s.getMonth(), s.getDate()))]
          : [];
    }
    for (const key of batch) {
      if (done(key)) return;
      emitted++;
      yield key;
    }
  }
}

export interface Occurrence {
  start: string;
  end: string;
  /** The occurrence's date (what exdates name). */
  date: string;
}

/** Occurrences of an event that overlap [from, to] (stamps or dates). */
export function occurrencesBetween(
  ev: { start: string; end: string; recurrence: Recurrence | null; exdates: string[] },
  from: string,
  to: string,
): Occurrence[] {
  // Length as whole days + the end's wall-clock time, so DST days don't stretch or shrink it.
  const spanDays = Math.max(0, daysBetween(ev.start, ev.end));
  const endTime = ev.end.slice(10);
  const time = ev.start.slice(10);
  const skip = new Set(ev.exdates);
  const out: Occurrence[] = [];
  for (const date of recurrenceDates(ev.start, ev.recurrence, from)) {
    const start = `${date}${time}`;
    if (start > to) break;
    const end = `${addDays(date, spanDays)}${endTime}`;
    if (end >= from && !skip.has(date)) out.push({ start, end, date });
  }
  return out;
}

/** The next due date after `dateKey` for a repeating task, or null when the rule has ended. */
export function nextDueDate(dateKey: string, rule: Recurrence): string | null {
  for (const d of recurrenceDates(dateKey, rule)) if (d > dateKey) return d;
  return null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Every 2 weeks on Mon, Wed" — for chips and for Jarvis's replies. */
export function describeRecurrence(r: Recurrence): string {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  let s = r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`;
  const days = r.byDay ?? [];
  if (r.freq === 'weekly' && days.length) {
    const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    s =
      sorted.join() === '1,2,3,4,5' && r.interval === 1
        ? 'Every weekday'
        : `${s} on ${sorted.map((d) => DAY_NAMES[d]).join(', ')}`;
  }
  if (r.until) s += ` until ${r.until}`;
  if (r.count) s += `, ${r.count} times`;
  return s;
}

/** Free gaps of at least `minutes` between busy blocks inside [dayStart, dayEnd] on one day. */
export function freeSlots(
  busy: Array<{ start: string; end: string }>,
  dayStart: string,
  dayEnd: string,
  minutes: number,
): Array<{ start: string; end: string }> {
  const sorted = busy
    .filter((b) => b.end > dayStart && b.start < dayEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: Array<{ start: string; end: string }> = [];
  let cursor = dayStart;
  for (const b of sorted) {
    if (b.start > cursor && minutesBetween(cursor, b.start) >= minutes)
      out.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (minutesBetween(cursor, dayEnd) >= minutes) out.push({ start: cursor, end: dayEnd });
  return out;
}
