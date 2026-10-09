import { z } from 'zod';
import {
  EventId,
  LocalDate,
  LocalStamp,
  LocalTime,
  RecurrenceSchema,
  TodoId,
  type CalEvent,
  type Todo,
} from '@shared/planner';
import {
  addDays,
  addMinutes,
  describeRecurrence,
  freeSlots,
  occurrencesBetween,
  parseLocal,
  toDateKey,
} from '@shared/planner-time';
import { parseQuickAdd } from '@shared/quick-add';
import { JarvisError } from '../errors';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import type { Planner } from './planner';

const TIMEOUT_MS = 5_000;
const LIST_LIMIT = 60;

/** "Sat 10 Oct 17:00" (or without the time for a date). */
export function human(s: string): string {
  const d = parseLocal(s);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return s.length > 10 ? `${day} ${s.slice(11, 16)}` : day;
}

function todoLine(t: Todo, lists: Map<string, string>): string {
  const bits = [
    `${t.id}`,
    `${t.status === 'done' ? '[x]' : t.status === 'doing' ? '[~]' : '[ ]'} ${t.title}`,
    t.dueDate ? `due ${human(t.dueTime ? `${t.dueDate}T${t.dueTime}` : t.dueDate)}` : '',
    t.priority < 4 ? `P${t.priority}` : '',
    t.listId ? (lists.get(t.listId) ?? '') : 'Inbox',
    t.recurrence ? describeRecurrence(t.recurrence) : '',
    t.tags.length ? t.tags.map((x) => `#${x}`).join(' ') : '',
    t.starred ? '★' : '',
  ];
  return bits.filter(Boolean).join(' · ');
}

const eventLine = (e: CalEvent, start = e.start, end = e.end): string =>
  [
    e.id,
    e.title,
    e.allDay ? `${human(start.slice(0, 10))} (all day)` : `${human(start)}–${end.slice(11, 16)}`,
    e.location,
    e.recurrence ? describeRecurrence(e.recurrence) : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** Finds one item by id or by words in its title; several matches come back as a question. */
function pick<T extends { id: string; title: string }>(
  items: T[],
  id: string | undefined,
  query: string | undefined,
): T | string {
  if (id) return items.find((x) => x.id === id) ?? `Nothing with id ${id}.`;
  const q = query?.trim().toLowerCase();
  if (!q) return 'Give the id or some words from the title.';
  const exact = items.filter((x) => x.title.toLowerCase() === q);
  const hits = exact.length ? exact : items.filter((x) => x.title.toLowerCase().includes(q));
  if (hits.length === 1 && hits[0]) return hits[0];
  if (hits.length === 0) return `Nothing matches "${query}".`;
  return `Several match, ask sir which one (or pass the id):\n${hits
    .slice(0, 10)
    .map((h) => `${h.id} · ${h.title}`)
    .join('\n')}`;
}

const TasksInput = z.object({
  action: z.enum([
    'list',
    'add',
    'update',
    'complete',
    'reopen',
    'delete',
    'lists',
    'create_list',
    'open',
  ]),
  /** add: natural language ("buy milk tomorrow 5pm #home !1 every week"). */
  text: z.string().max(500).optional(),
  id: TodoId.optional(),
  query: z.string().max(200).optional(),
  title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  list: z.string().max(60).optional(),
  dueDate: LocalDate.nullable().optional(),
  dueTime: LocalTime.nullable().optional(),
  remindAt: LocalStamp.nullable().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  status: z.enum(['todo', 'doing', 'done']).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  starred: z.boolean().optional(),
  recurrence: RecurrenceSchema.nullable().optional(),
  parentId: TodoId.optional(),
  filter: z.enum(['today', 'overdue', 'upcoming', 'all', 'done', 'inbox', 'starred']).optional(),
});
type TasksInput = z.infer<typeof TasksInput>;

const CalendarInput = z.object({
  action: z.enum(['agenda', 'add', 'update', 'delete', 'free_slots', 'calendars', 'open']),
  /** add: natural language ("lunch with Sam friday 1-2pm"). */
  text: z.string().max(500).optional(),
  id: EventId.optional(),
  query: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
  start: LocalStamp.optional(),
  end: LocalStamp.optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
  calendar: z.string().max(60).optional(),
  recurrence: RecurrenceSchema.nullable().optional(),
  reminders: z.array(z.number().int().min(0).max(40_320)).max(5).optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  /** delete: which occurrence of a repeating event; free_slots: the day. */
  date: LocalDate.optional(),
  scope: z.enum(['one', 'following', 'all']).optional(),
  minutes: z.number().int().min(5).max(720).optional(),
});
type CalendarInput = z.infer<typeof CalendarInput>;

/** Jarvis's full control of Tasks and Calendar (PRD F25/F26). Deleting asks Sir first. */
export function createPlannerTools(
  planner: Planner,
  open: (view: 'tasks' | 'calendar') => void,
): Tool[] {
  /** Finds a list by name; only adding a task may create a new one (reads never change anything). */
  const listId = (name: string | undefined, create: boolean): string | null | undefined => {
    if (name === undefined) return undefined;
    if (!name.trim() || name.trim().toLowerCase() === 'inbox') return null;
    const found = planner.lists().find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
    if (found) return found.id;
    if (!create)
      throw new JarvisError('INVALID', 'no list', `There is no list called "${name.trim()}".`);
    return planner.saveList({ name: name.trim() }).id;
  };

  function listTasks(i: TasksInput): string {
    const today = toDateKey(new Date());
    const lists = new Map(planner.lists().map((l) => [l.id, l.name]));
    const filter = i.filter ?? 'today';
    const wanted = i.list ? listId(i.list, false) : undefined;
    const rows = planner
      .todos()
      .filter((t) => !t.parentId)
      .filter((t) => (wanted === undefined ? true : t.listId === wanted))
      .filter((t) => {
        const open = t.status !== 'done';
        switch (filter) {
          case 'today':
            return open && !!t.dueDate && t.dueDate <= today;
          case 'overdue':
            return open && !!t.dueDate && t.dueDate < today;
          case 'upcoming':
            return open && !!t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 7);
          case 'inbox':
            return open && !t.listId;
          case 'starred':
            return open && t.starred;
          case 'done':
            return !open;
          default:
            return open;
        }
      })
      .filter((t) => !i.query || t.title.toLowerCase().includes(i.query.toLowerCase()))
      .sort(
        (a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') || a.priority - b.priority,
      );
    if (!rows.length) return `No ${filter} tasks.`;
    const more = rows.length > LIST_LIMIT ? `\n…and ${rows.length - LIST_LIMIT} more.` : '';
    return (
      rows
        .slice(0, LIST_LIMIT)
        .map((t) => todoLine(t, lists))
        .join('\n') + more
    );
  }

  const tasks = defineTool<TasksInput>({
    name: 'tasks',
    description:
      "Sir's to-do list (Tasks view). action=list (filter: today [default, includes overdue] | overdue | upcoming | inbox | starred | done | all; optional list, query); add (text in natural language like 'pay rent every month on the 1st #home !1', or title + fields); update / complete / reopen / delete (id, or query words from the title); lists; create_list (list); open (shows the Tasks view). Priority 1 = urgent … 4 = none. Dates YYYY-MM-DD, times HH:MM, local.",
    input: TasksInput,
    tier: (i) => (i.action === 'delete' ? 'CONFIRM' : 'SAFE'),
    destructive: (i) => i.action === 'delete',
    timeoutMs: TIMEOUT_MS,
    summarize: (i) =>
      i.action === 'add'
        ? `Add task "${i.title ?? i.text ?? ''}"`
        : i.action === 'list' || i.action === 'lists' || i.action === 'open'
          ? `Look at tasks${i.filter ? ` (${i.filter})` : ''}`
          : `${i.action.replace('_', ' ')} task ${i.id ?? i.query ?? i.list ?? ''}`.trim(),
    confirm: (i) => {
      const t = pick(planner.todos(), i.id, i.query);
      return {
        title: 'Delete this task?',
        actionLabel: 'Delete',
        details:
          typeof t === 'string'
            ? t
            : `"${t.title}"${t.dueDate ? ` · due ${human(t.dueDate)}` : ''}`,
      };
    },
    async run(i) {
      switch (i.action) {
        case 'list':
          return Promise.resolve(ok(listTasks(i)));
        case 'lists': {
          const counts = new Map<string | null, number>();
          for (const t of planner.todos())
            if (t.status !== 'done') counts.set(t.listId, (counts.get(t.listId) ?? 0) + 1);
          const rows = [`Inbox (${counts.get(null) ?? 0} open)`];
          for (const l of planner.lists())
            rows.push(`${l.icon} ${l.name} (${counts.get(l.id) ?? 0} open)`.trim());
          return Promise.resolve(ok(rows.join('\n')));
        }
        case 'create_list': {
          if (!i.list?.trim()) return Promise.resolve(fail('Give the list name.'));
          return Promise.resolve(
            ok(`List "${planner.saveList({ name: i.list.trim() }).name}" ready.`),
          );
        }
        case 'open':
          open('tasks');
          return Promise.resolve(ok('Tasks view open.'));
        case 'add': {
          const q = i.text ? parseQuickAdd(i.text) : null;
          const lists = planner.lists();
          const hashList = q?.hashtags
            .map((h) => lists.find((l) => l.name.toLowerCase() === h.toLowerCase()))
            .find(Boolean);
          const title = i.title ?? q?.title;
          if (!title) return Promise.resolve(fail('Give the task title.'));
          const t = planner.saveTodo({
            title,
            notes: i.notes,
            listId: listId(i.list, true) ?? hashList?.id ?? null,
            parentId: i.parentId,
            dueDate: i.dueDate ?? q?.date ?? null,
            dueTime: i.dueTime ?? q?.time ?? null,
            durationMin: q?.durationMin ?? null,
            remindAt: i.remindAt,
            priority: i.priority ?? q?.priority ?? 4,
            tags:
              i.tags ??
              q?.hashtags.filter((h) => h.toLowerCase() !== hashList?.name.toLowerCase()) ??
              [],
            starred: i.starred,
            recurrence: i.recurrence ?? q?.recurrence ?? null,
          });
          const lists2 = new Map(planner.lists().map((l) => [l.id, l.name]));
          return Promise.resolve(ok(`Added: ${todoLine(t, lists2)}`));
        }
        default: {
          const found = pick(planner.todos(), i.id, i.query);
          if (typeof found === 'string') return Promise.resolve(fail(found));
          if (i.action === 'delete') {
            planner.deleteTodo(found.id);
            return Promise.resolve(ok(`Deleted "${found.title}".`));
          }
          const t = planner.saveTodo({
            id: found.id,
            ...(i.action === 'complete' ? { status: 'done' as const } : {}),
            ...(i.action === 'reopen' ? { status: 'todo' as const } : {}),
            ...(i.action === 'update'
              ? {
                  title: i.title,
                  notes: i.notes,
                  listId: listId(i.list, false),
                  dueDate: i.dueDate,
                  dueTime: i.dueTime,
                  remindAt: i.remindAt,
                  priority: i.priority,
                  status: i.status,
                  tags: i.tags,
                  starred: i.starred,
                  recurrence: i.recurrence,
                }
              : {}),
          });
          const lists = new Map(planner.lists().map((l) => [l.id, l.name]));
          const rolled = i.action === 'complete' && t.status !== 'done';
          return Promise.resolve(
            ok(
              rolled
                ? `Done. It repeats: next one ${todoLine(t, lists)}`
                : `Updated: ${todoLine(t, lists)}`,
            ),
          );
        }
      }
    },
  });

  /** Finds a calendar by name; only adding an event may create a new one. */
  const calendarId = (name: string | undefined, create: boolean): string | undefined => {
    if (!name) return undefined;
    const found = planner
      .calendars()
      .find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (found) return found.id;
    if (!create)
      throw new JarvisError(
        'INVALID',
        'no calendar',
        `There is no calendar called "${name.trim()}".`,
      );
    return planner.saveCalendar({ name: name.trim() }).id;
  };

  function eventFromText(text: string):
    | {
        title: string;
        start: string;
        end: string;
        allDay: boolean;
        recurrence: CalEvent['recurrence'];
      }
    | string {
    const q = parseQuickAdd(text);
    if (!q.date) return 'Say when the event is (a day, and a time unless it is all day).';
    if (!q.time)
      return {
        title: q.title,
        start: `${q.date}T00:00`,
        end: `${q.date}T23:59`,
        allDay: true,
        recurrence: q.recurrence,
      };
    const start = `${q.date}T${q.time}`;
    return {
      title: q.title,
      start,
      end: addMinutes(start, q.durationMin ?? 60),
      allDay: false,
      recurrence: q.recurrence,
    };
  }

  const calendar = defineTool<CalendarInput>({
    name: 'calendar',
    description:
      "Sir's calendar (Calendar view). action=agenda (from, to as YYYY-MM-DD; default today; includes tasks due); add (text in natural language like 'dentist friday 4-5pm', or title + start/end as YYYY-MM-DDTHH:MM, allDay, location, calendar, recurrence, reminders in minutes before); update (id or query + fields); delete (id or query; for a repeating event give date and scope one|following|all); free_slots (date, minutes: free gaps between 09:00 and 18:00); calendars; open (shows the Calendar view).",
    input: CalendarInput,
    tier: (i) => (i.action === 'delete' ? 'CONFIRM' : 'SAFE'),
    destructive: (i) => i.action === 'delete',
    // Events can come from imported .ics files, so their text is outside content (Security.md §6).
    untrustedOutput: true,
    timeoutMs: TIMEOUT_MS,
    summarize: (i) =>
      i.action === 'add'
        ? `Add event "${i.title ?? i.text ?? ''}"`
        : i.action === 'agenda' ||
            i.action === 'free_slots' ||
            i.action === 'calendars' ||
            i.action === 'open'
          ? `Look at the calendar${i.from ? ` from ${i.from}` : ''}`
          : `${i.action} event ${i.id ?? i.query ?? ''}`.trim(),
    confirm: (i) => {
      const e = pick(planner.events(), i.id, i.query);
      const which =
        i.date && typeof e !== 'string' && e.recurrence
          ? ` · ${i.scope ?? 'all'} from ${human(i.date)}`
          : '';
      return {
        title: 'Delete this event?',
        actionLabel: 'Delete',
        details: typeof e === 'string' ? e : `"${e.title}" · ${human(e.start)}${which}`,
      };
    },
    async run(i) {
      const today = toDateKey(new Date());
      switch (i.action) {
        case 'calendars':
          return Promise.resolve(
            ok(
              planner
                .calendars()
                .map((c) => `${c.id} · ${c.name}${c.visible ? '' : ' (hidden)'}`)
                .join('\n'),
            ),
          );
        case 'open':
          open('calendar');
          return Promise.resolve(ok('Calendar view open.'));
        case 'agenda': {
          const from = i.from ?? today;
          const to = i.to ?? from;
          const items = planner.agenda(from, to);
          if (!items.length)
            return Promise.resolve(
              ok(
                `Nothing on the calendar ${from === to ? `for ${human(from)}` : `from ${human(from)} to ${human(to)}`}.`,
              ),
            );
          return Promise.resolve(
            ok(
              items
                .slice(0, LIST_LIMIT * 2)
                .map((a) =>
                  [
                    a.kind === 'task' ? `task ${a.done ? '[x]' : '[ ]'}` : 'event',
                    a.id,
                    a.title,
                    a.allDay
                      ? `${human(a.start.slice(0, 10))} (all day)`
                      : `${human(a.start)}${a.end ? `–${a.end.slice(11, 16)}` : ''}`,
                    a.where,
                  ].join(' · '),
                )
                .join('\n'),
            ),
          );
        }
        case 'free_slots': {
          const day = i.date ?? today;
          const busy = planner
            .events()
            .filter((e) => !e.allDay)
            .flatMap((e) => occurrencesBetween(e, `${day}T00:00`, `${day}T23:59`));
          const slots = freeSlots(busy, `${day}T09:00`, `${day}T18:00`, i.minutes ?? 30);
          return Promise.resolve(
            ok(
              slots.length
                ? `Free on ${human(day)}: ${slots.map((s) => `${s.start.slice(11)}–${s.end.slice(11)}`).join(', ')}`
                : `No free gap of ${i.minutes ?? 30} minutes on ${human(day)} between 09:00 and 18:00.`,
            ),
          );
        }
        case 'add': {
          let base: ReturnType<typeof eventFromText> | null = null;
          if (i.text && !i.start) base = eventFromText(i.text);
          if (typeof base === 'string') return Promise.resolve(fail(base));
          const title = i.title ?? base?.title;
          const start = i.start ?? base?.start;
          if (!title || !start)
            return Promise.resolve(fail('Give the title and the start (YYYY-MM-DDTHH:MM).'));
          const ev = planner.saveEvent({
            title,
            start,
            end: i.end ?? base?.end ?? addMinutes(start, 60),
            allDay: i.allDay ?? base?.allDay ?? false,
            location: i.location,
            notes: i.notes,
            calendarId: calendarId(i.calendar, true),
            recurrence: i.recurrence ?? base?.recurrence ?? null,
            reminders: i.reminders,
          });
          return Promise.resolve(ok(`Added: ${eventLine(ev)}`));
        }
        default: {
          const found = pick(planner.events(), i.id, i.query);
          if (typeof found === 'string') return Promise.resolve(fail(found));
          if (i.action === 'delete') {
            planner.deleteEvent(found.id, i.date, i.scope ?? 'all');
            return Promise.resolve(
              ok(
                `Deleted "${found.title}"${i.date && found.recurrence ? ` (${i.scope ?? 'all'})` : ''}.`,
              ),
            );
          }
          const ev = planner.saveEvent({
            id: found.id,
            title: i.title,
            start: i.start,
            end:
              i.end ?? (i.start ? addMinutes(i.start, Math.max(15, minutesOf(found))) : undefined),
            allDay: i.allDay,
            location: i.location,
            notes: i.notes,
            calendarId: calendarId(i.calendar, false),
            recurrence: i.recurrence,
            reminders: i.reminders,
          });
          return Promise.resolve(ok(`Updated: ${eventLine(ev)}`));
        }
      }
    },
  });

  return [tasks, calendar];
}

/** Keeps an event's length when only its start moves. */
const minutesOf = (e: CalEvent): number =>
  Math.round((parseLocal(e.end).getTime() - parseLocal(e.start).getTime()) / 60_000);
