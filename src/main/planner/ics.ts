import type { CalEvent, EventPatch, Recurrence } from '@shared/planner';
import { addDays, addMinutes, toStamp } from '@shared/planner-time';

/**
 * iCalendar (RFC 5545) import/export for the Calendar: the subset Google, Outlook and Apple export
 * (VEVENT with DTSTART/DTEND, SUMMARY, LOCATION, DESCRIPTION, RRULE, EXDATE, VALARM).
 * ponytail: TZID times are read as local wall-clock; a full zone database lands when Sir travels.
 */

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQS: Record<string, Recurrence['freq']> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};
const MAX_EVENTS = 5000;

const escapeText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** One pass, so an escaped backslash before "n" stays a backslash and an "n". */
const unescapeText = (s: string): string =>
  s.replace(/\\([nN\\;,])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/** Lines longer than 75 characters continue on the next line after one space. */
function fold(line: string): string {
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 74) parts.push(line.slice(i, i + 74));
  return parts.join('\r\n ');
}

const icsDate = (d: string): string => d.replace(/-/g, '');
const icsStamp = (s: string): string =>
  `${icsDate(s.slice(0, 10))}T${s.slice(11, 13)}${s.slice(14, 16)}00`;

function rrule(r: Recurrence): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`, `INTERVAL=${r.interval}`];
  if (r.freq === 'weekly' && r.byDay?.length)
    parts.push(`BYDAY=${r.byDay.map((d) => BYDAY[d]).join(',')}`);
  if (r.until) parts.push(`UNTIL=${icsDate(r.until)}T235959`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  return parts.join(';');
}

export function toIcs(events: CalEvent[], now = new Date()): string {
  const stamp = `${icsStamp(toStamp(now))}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jarvis//Calendar//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@jarvis`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(
        `DTSTART;VALUE=DATE:${icsDate(e.start.slice(0, 10))}`,
        `DTEND;VALUE=DATE:${icsDate(addDays(e.end.slice(0, 10), 1))}`,
      );
    } else lines.push(`DTSTART:${icsStamp(e.start)}`, `DTEND:${icsStamp(e.end)}`);
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escapeText(e.notes)}`);
    if (e.recurrence) lines.push(`RRULE:${rrule(e.recurrence)}`);
    for (const x of e.exdates)
      lines.push(
        e.allDay
          ? `EXDATE;VALUE=DATE:${icsDate(x)}`
          : `EXDATE:${icsDate(x)}${icsStamp(e.start).slice(8)}`,
      );
    for (const m of e.reminders)
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(e.title)}`,
        `TRIGGER:-PT${m}M`,
        'END:VALARM',
      );
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

interface Prop {
  name: string;
  params: string;
  value: string;
}

function parseProp(line: string): Prop | null {
  const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/i.exec(line);
  return m
    ? { name: (m[1] ?? '').toUpperCase(), params: (m[2] ?? '').toUpperCase(), value: m[3] ?? '' }
    : null;
}

/** "20261009T173000Z" (UTC → local), "20261009T173000" (local) or "20261009" (date). */
function readTime(value: string): { stamp: string; dateOnly: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined) return { stamp: `${y}-${mo}-${d}T00:00`, dateOnly: true };
  if (z)
    return { stamp: toStamp(new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi!))), dateOnly: false };
  return { stamp: `${y}-${mo}-${d}T${h}:${mi}`, dateOnly: false };
}

function readRrule(value: string): Recurrence | 'unsupported' {
  const kv = new Map(
    value.split(';').map((p) => {
      const [k = '', v = ''] = p.split('=');
      return [k.toUpperCase(), v] as const;
    }),
  );
  const freq = FREQS[(kv.get('FREQ') ?? '').toUpperCase()];
  // Only rules Jarvis can follow exactly: hourly, "2nd Tuesday", BYMONTHDAY… are left out, not guessed.
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST']);
  const byDayRaw = kv.get('BYDAY') ?? '';
  if (
    !freq ||
    [...kv.keys()].some((k) => k !== '' && !known.has(k)) ||
    (byDayRaw !== '' && (freq !== 'weekly' || /\d/.test(byDayRaw)))
  )
    return 'unsupported';
  const r: Recurrence = {
    freq,
    interval: Math.min(366, Math.max(1, Number(kv.get('INTERVAL') ?? 1) || 1)),
  };
  const byDay = (kv.get('BYDAY') ?? '')
    .split(',')
    .map((d) => BYDAY.indexOf(d.slice(-2).toUpperCase()))
    .filter((d) => d >= 0);
  if (freq === 'weekly' && byDay.length) r.byDay = byDay;
  const until = kv.get('UNTIL') && readTime(kv.get('UNTIL') ?? '');
  if (until) r.until = until.stamp.slice(0, 10);
  const count = Number(kv.get('COUNT'));
  if (count >= 1) r.count = Math.min(1000, count);
  return r;
}

/** -PT15M, -PT1H, -P1D, -P1DT2H, PT0S → minutes before the start. */
function readTrigger(value: string): number | null {
  const m = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const mins =
    Number(m[1] ?? 0) * 10080 +
    Number(m[2] ?? 0) * 1440 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0);
  return mins <= 40_320 ? mins : null;
}

/** Events in an .ics file, ready for Calendar (without ids). Unknown properties are ignored. */
export function parseIcs(text: string): {
  events: ImportedEvent[];
  /** Events left out because their repeat rule can't be followed exactly. */
  skipped: number;
} {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out: ImportedEvent[] = [];
  let skipped = 0;
  let cur: Prop[] | null = null;
  let inAlarm = false;
  let alarms: number[] = [];
  for (const line of lines) {
    if (out.length >= MAX_EVENTS) break;
    if (line === 'BEGIN:VEVENT') {
      cur = [];
      alarms = [];
    } else if (line === 'BEGIN:VALARM') inAlarm = true;
    else if (line === 'END:VALARM') inAlarm = false;
    else if (line === 'END:VEVENT' && cur) {
      const ev = buildEvent(cur, alarms);
      if (ev === 'unsupported') skipped++;
      else if (ev) out.push(ev);
      cur = null;
    } else if (cur) {
      const p = parseProp(line);
      if (!p) continue;
      if (inAlarm) {
        const t =
          p.name === 'TRIGGER' && !p.params.includes('VALUE=DATE-TIME')
            ? readTrigger(p.value)
            : null;
        if (t !== null && alarms.length < 5) alarms.push(t);
      } else cur.push(p);
    }
  }
  return { events: out, skipped };
}

type ImportedEvent = Required<Omit<EventPatch, 'id' | 'calendarId'>>;

function buildEvent(props: Prop[], alarms: number[]): ImportedEvent | 'unsupported' | null {
  const get = (n: string): Prop | undefined => props.find((p) => p.name === n);
  const start = get('DTSTART') && readTime(get('DTSTART')?.value ?? '');
  if (!start) return null;
  const endProp = get('DTEND') && readTime(get('DTEND')?.value ?? '');
  const allDay = start.dateOnly;
  let end: string;
  if (allDay) {
    // DTEND of an all-day event is the day after; Jarvis stores the last day at 23:59.
    const last = endProp ? addDays(endProp.stamp.slice(0, 10), -1) : start.stamp.slice(0, 10);
    end = `${last < start.stamp.slice(0, 10) ? start.stamp.slice(0, 10) : last}T23:59`;
  } else end = endProp && endProp.stamp > start.stamp ? endProp.stamp : addMinutes(start.stamp, 60);
  const exdates = props
    .filter((p) => p.name === 'EXDATE')
    .flatMap((p) => p.value.split(','))
    .map((v) => readTime(v)?.stamp.slice(0, 10))
    .filter((v): v is string => !!v)
    .slice(0, 500);
  const rule = get('RRULE');
  const recurrence = rule ? readRrule(rule.value) : null;
  if (recurrence === 'unsupported') return 'unsupported';
  return {
    title:
      unescapeText(get('SUMMARY')?.value ?? '')
        .trim()
        .slice(0, 300) || '(no title)',
    notes: unescapeText(get('DESCRIPTION')?.value ?? '').slice(0, 20_000),
    location: unescapeText(get('LOCATION')?.value ?? '').slice(0, 300),
    start: allDay ? `${start.stamp.slice(0, 10)}T00:00` : start.stamp,
    end,
    allDay,
    recurrence,
    exdates,
    reminders: [...new Set(alarms)],
  };
}
