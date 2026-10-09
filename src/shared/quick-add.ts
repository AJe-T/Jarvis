import type { Recurrence } from './planner';
import { addDays, recurrenceDates, toDateKey, toTime } from './planner-time';

/**
 * Natural-language quick add (Todoist / Fantastical style), shared by the Tasks and Calendar boxes:
 * "Pay rent every month on the 1st #home !1", "Lunch with Sam fri 1-2pm", "Call mom tomorrow 6pm".
 * Dates are read day-first ("12/10" = 12 October), as written in India.
 */
export interface QuickAdd {
  title: string;
  date: string | null;
  time: string | null;
  endTime: string | null;
  durationMin: number | null;
  recurrence: Recurrence | null;
  priority: number | null;
  /** "#word" tokens: a list name when one matches, otherwise a tag. */
  hashtags: string[];
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_RE = '(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?';
const FULL_DAY_RE = '(?:sun|mon|tues|wednes|thurs|fri|satur)day';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const UNIT_FREQ: Record<string, Recurrence['freq']> = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

const dayIndex = (word: string): number => DAYS.indexOf(word.slice(0, 3).toLowerCase());
const pad = (n: number): string => String(n).padStart(2, '0');

function clock(h: number, m: number, ampm: string | undefined): string | null {
  let hour = h;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    hour = (h % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hour > 23 || m > 59) return null;
  return `${pad(hour)}:${pad(m)}`;
}

function dateOf(y: number, m0: number, d: number): string | null {
  const date = new Date(y, m0, d);
  return date.getMonth() === m0 && date.getDate() === d ? toDateKey(date) : null;
}

/** A day/month without a year means the next time it comes round. */
function upcoming(m0: number, d: number, year: number | undefined, today: string): string | null {
  const y = year ?? Number(today.slice(0, 4));
  const key = dateOf(y, m0, d);
  if (!key || year !== undefined || key >= today) return key;
  return dateOf(y + 1, m0, d);
}

export function parseQuickAdd(text: string, now = new Date()): QuickAdd {
  const today = toDateKey(now);
  const out: QuickAdd = {
    title: '',
    date: null,
    time: null,
    endTime: null,
    durationMin: null,
    recurrence: null,
    priority: null,
    hashtags: [],
  };
  let rest = ` ${text.slice(0, 500)} `;
  /** Runs a pattern once; the matched words leave the title when `fn` accepts them. */
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void): void => {
    const m = re.exec(rest);
    if (m && fn(m) !== false)
      rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
  };

  while (/\s#[\p{L}\p{N}_-]+/u.test(rest))
    take(/\s#([\p{L}\p{N}_-]+)/u, (m) => void out.hashtags.push(m[1] ?? ''));
  take(/\s(?:!|p)([1-4])(?=\s)/i, (m) => void (out.priority = Number(m[1])));

  // ── repeats ──
  take(/\b(?:every\s+weekday|weekdays)\b/i, () => {
    out.recurrence = { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] };
  });
  take(new RegExp(`\\bevery\\s+(${DAY_RE}(?:\\s*(?:,|and|&)\\s*${DAY_RE})*)\\b`, 'i'), (m) => {
    const byDay = [...(m[1] ?? '').matchAll(new RegExp(DAY_RE, 'gi'))].map((d) => dayIndex(d[0]));
    out.recurrence = { freq: 'weekly', interval: 1, byDay };
  });
  take(/\bevery\s+(?:(other|\d+)\s+)?(day|week|month|year)s?\b/i, (m) => {
    const n = m[1]?.toLowerCase() === 'other' ? 2 : Number(m[1] ?? 1);
    out.recurrence = { freq: UNIT_FREQ[(m[2] ?? 'day').toLowerCase()] ?? 'daily', interval: n };
  });
  take(/\b(daily|weekly|monthly|yearly|annually)\b/i, (m) => {
    const w = (m[1] ?? '').toLowerCase();
    out.recurrence = { freq: w === 'annually' ? 'yearly' : (w as Recurrence['freq']), interval: 1 };
  });

  // ── length ──
  take(/\bfor\s+(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i, (m) => {
    const n = Number(m[1]);
    out.durationMin = Math.round((m[2] ?? 'm').toLowerCase().startsWith('h') ? n * 60 : n);
  });

  // ── dates ──
  const pre = '(?:(?:by|on|due|before)\\s+)?';
  take(/\bin\s+(\d+)\s*(min|mins|minutes?|m|hours?|hrs?|h)\b/i, (m) => {
    const mins = Number(m[1]) * ((m[2] ?? '').toLowerCase().startsWith('h') ? 60 : 1);
    const at = new Date(now.getTime() + mins * 60_000);
    out.date = toDateKey(at);
    out.time = toTime(at);
  });
  take(/\bin\s+(\d+)\s*(days?|d|weeks?|w|months?)\b/i, (m) => {
    const n = Number(m[1]);
    const u = (m[2] ?? 'd').toLowerCase();
    if (u.startsWith('mo')) {
      const d = new Date(now);
      d.setMonth(d.getMonth() + n);
      out.date = toDateKey(d);
    } else out.date = addDays(today, u.startsWith('w') ? n * 7 : n);
  });
  take(new RegExp(`\\b${pre}(day after tomorrow|today|tonight|tomorrow|tmrw|tmr)\\b`, 'i'), (m) => {
    const w = (m[1] ?? '').toLowerCase();
    out.date =
      w === 'today' || w === 'tonight' ? today : addDays(today, w.startsWith('day') ? 2 : 1);
    if (w === 'tonight') out.time ??= '20:00';
  });
  take(/\b(next\s+week|this\s+weekend|next\s+weekend|weekend)\b/i, (m) => {
    const w = (m[1] ?? '').toLowerCase();
    const dow = now.getDay();
    if (w === 'next week') out.date = addDays(today, (8 - dow) % 7 || 7);
    else out.date = addDays(today, ((6 - dow + 7) % 7) + (w.startsWith('next') ? 7 : 0));
  });
  const weekday = (next: boolean, name: string): void => {
    const delta = (dayIndex(name) - now.getDay() + 7) % 7;
    out.date = addDays(today, next ? delta || 7 : delta);
  };
  // Full names anywhere; short ones ("sat", "sun") only after on/by/next so "sun cream" stays a title.
  take(new RegExp(`\\b${pre}(?:(next|this)\\s+)?(${FULL_DAY_RE})\\b`, 'i'), (m) =>
    weekday(m[1]?.toLowerCase() === 'next', m[2] ?? ''),
  );
  take(new RegExp(`\\b(by|on|due|before|next|this)\\s+(${DAY_RE})\\b`, 'i'), (m) =>
    weekday(m[1]?.toLowerCase() === 'next', m[2] ?? ''),
  );
  take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => {
    out.date = dateOf(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return out.date !== null;
  });
  take(
    new RegExp(
      `\\b${pre}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`,
      'i',
    ),
    (m) => {
      out.date = upcoming(
        MONTHS.indexOf((m[2] ?? '').slice(0, 3).toLowerCase()),
        Number(m[1]),
        m[3] ? Number(m[3]) : undefined,
        today,
      );
      return out.date !== null;
    },
  );
  take(
    new RegExp(`\\b${pre}${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    (m) => {
      out.date = upcoming(
        MONTHS.indexOf((m[1] ?? '').slice(0, 3).toLowerCase()),
        Number(m[2]),
        m[3] ? Number(m[3]) : undefined,
        today,
      );
      return out.date !== null;
    },
  );
  take(new RegExp(`\\b${pre}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b`), (m) => {
    const y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
    out.date = upcoming(Number(m[2]) - 1, Number(m[1]), y, today);
    return out.date !== null;
  });
  take(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (m) => {
    const d = Number(m[1]);
    const y = now.getFullYear();
    const key = dateOf(y, now.getMonth(), d);
    const next = new Date(y, now.getMonth() + 1, 1);
    out.date = key && key >= today ? key : dateOf(next.getFullYear(), next.getMonth(), d);
    return out.date !== null;
  });

  // ── times ──
  take(
    /\b(?:(from|at)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
    (m) => {
      const [, lead, h1, m1, ap1, h2, m2, ap2] = m;
      if (!lead && !ap1 && !ap2 && !m1 && !m2) return false;
      // "1-2pm": the first time shares the second's am/pm unless that would put it after the end.
      let first = ap1 ?? ap2;
      if (!ap1 && ap2 && Number(h1) > Number(h2) && Number(h1) !== 12)
        first = ap2 === 'pm' ? 'am' : 'pm';
      const a = clock(Number(h1), Number(m1 ?? 0), first);
      const b = clock(Number(h2), Number(m2 ?? 0), ap2 ?? ap1);
      if (!a || !b) return false;
      out.time = a;
      out.endTime = b;
    },
  );
  take(/\b(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => {
    out.time = clock(Number(m[1]), Number(m[2] ?? 0), m[3]);
    return out.time !== null;
  });
  take(/\b(?:at\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => {
    out.time = clock(Number(m[1]), Number(m[2]), undefined);
  });
  take(/\b(?:at\s+)?(noon|midday|midnight|morning|afternoon|evening)\b/i, (m) => {
    const w = (m[1] ?? '').toLowerCase();
    out.time =
      {
        noon: '12:00',
        midday: '12:00',
        midnight: '00:00',
        morning: '09:00',
        afternoon: '14:00',
        evening: '18:00',
      }[w] ?? null;
  });
  take(/\bat\s+(\d{1,2})\b/i, (m) => {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return false;
    // "at 5" means 5 pm in the working day; "at 9" means 9 am.
    out.time = clock(h, 0, h <= 7 || h === 12 ? 'pm' : 'am');
  });

  const passed = (d: string): boolean => d === today && !!out.time && out.time <= toTime(now);
  if (out.recurrence && !out.date)
    for (const d of recurrenceDates(today, out.recurrence))
      if (!passed(d)) {
        out.date = d;
        break;
      }
  if (out.time && !out.date) out.date = passed(today) ? addDays(today, 1) : today;
  if (out.time && out.endTime && !out.durationMin) {
    const [ah = 0, am = 0] = out.time.split(':').map(Number);
    const [bh = 0, bm = 0] = out.endTime.split(':').map(Number);
    const mins = bh * 60 + bm - (ah * 60 + am);
    if (mins > 0) out.durationMin = mins;
  }
  out.title = rest
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:at|on|by|due|from|every|in)\s*$/i, '')
    .replace(/^[\s,;-]+|[\s,;-]+$/g, '')
    .trim();
  return out;
}
