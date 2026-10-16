import {
  CalendarSchema,
  EventSchema,
  PLANNER_COLORS,
  TodoListSchema,
  TodoSchema,
  type CalEvent,
  type Calendar,
  type EventPatch,
  type Todo,
  type TodoList,
  type TodoPatch,
} from '@shared/planner';
import {
  addDays,
  addMinutes,
  daysBetween,
  nextDueDate,
  occurrencesBetween,
  shiftDays,
  toStamp,
} from '@shared/planner-time';
import { tx, type Db } from '../db/connection';
import { JarvisError } from '../errors';
import { newId, nowIso } from '../lib/util';
import type { Logger } from '../logging/logger';
import { parseIcs, toIcs } from './ics';
import { createPlannerRepo } from './planner-repo';

const TICK_MS = 30_000;
/** Reminders missed while Jarvis was closed still fire if they were due this recently. */
const LOOKBACK_MIN = 15;

export interface AgendaItem {
  kind: 'event' | 'task';
  id: string;
  title: string;
  /** Local stamp, or a date for an all-day item / a task with no time. */
  start: string;
  end: string | null;
  allDay: boolean;
  where: string;
  done: boolean;
}

/** Drops keys whose value is undefined, so a patch only overwrites what it names. */
function defined<T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

export const fmtMinutes = (m: number): string =>
  m === 0
    ? 'now'
    : m % 1440 === 0
      ? `${m / 1440} day${m === 1440 ? '' : 's'}`
      : m % 60 === 0
        ? `${m / 60} hour${m === 60 ? '' : 's'}`
        : `${m} minutes`;

/**
 * Tasks and Calendar (PRD F25/F26): one service for the IPC handlers, Jarvis's tools and the
 * reminder ticker, so every change goes through the same checks and refreshes the UI once.
 */
export function createPlanner(deps: {
  db: Db;
  logger: Logger;
  deliver(title: string, body: string): void;
  onChange(): void;
}) {
  const repo = createPlannerRepo(deps.db);
  const log = deps.logger.child({ module: 'planner' });
  let timer: ReturnType<typeof setInterval> | null = null;

  if (repo.calendars().length === 0) {
    const ts = nowIso();
    repo.putCalendar({ id: newId('cal_'), name: 'Personal', color: '#22d3ee', visible: true }, ts);
    repo.putCalendar({ id: newId('cal_'), name: 'Work', color: '#a78bfa', visible: true }, ts);
  }

  const notFound = (what: string): JarvisError =>
    new JarvisError('NOT_FOUND', `${what} not found`, `That ${what} no longer exists.`);

  // ── lists ──
  function saveList(p: {
    id?: string | undefined;
    name?: string | undefined;
    color?: string | undefined;
    icon?: string | undefined;
    sortOrder?: number | undefined;
    description?: string | undefined;
    wipLimit?: number | null | undefined;
    archived?: boolean | undefined;
  }): TodoList {
    const prev = p.id ? repo.lists().find((l) => l.id === p.id) : undefined;
    if (p.id && !prev) throw notFound('list');
    if (!prev && !p.name?.trim())
      throw new JarvisError('INVALID', 'list needs a name', 'Give the list a name.');
    const count = repo.lists().length;
    const list = TodoListSchema.parse({
      id: prev?.id ?? newId('tl_'),
      name: p.name ?? prev?.name,
      color: p.color ?? prev?.color ?? PLANNER_COLORS[count % PLANNER_COLORS.length],
      icon: p.icon ?? prev?.icon ?? '',
      sortOrder: p.sortOrder ?? prev?.sortOrder ?? count,
      description: p.description ?? prev?.description ?? '',
      wipLimit: p.wipLimit !== undefined ? p.wipLimit : (prev?.wipLimit ?? null),
      archived: p.archived ?? prev?.archived ?? false,
    });
    repo.putList(list, nowIso());
    deps.onChange();
    return list;
  }

  // ── todos ──
  function saveTodo(patch: TodoPatch): Todo {
    const ts = nowIso();
    const prev = patch.id ? repo.todo(patch.id) : undefined;
    if (patch.id && !prev) throw notFound('task');
    const base: Todo = prev ?? {
      id: newId('td_'),
      listId: null,
      parentId: null,
      title: '',
      notes: '',
      status: 'todo',
      priority: 4,
      dueDate: null,
      dueTime: null,
      durationMin: null,
      remindAt: null,
      recurrence: null,
      tags: [],
      starred: false,
      sortOrder: Date.now(),
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
    };
    const { id: _id, ...fields } = patch;
    let next: Todo = { ...base, ...defined(fields), updatedAt: ts };
    if (!next.dueDate) next.dueTime = null;
    const dueStamp = next.dueDate && next.dueTime ? `${next.dueDate}T${next.dueTime}` : null;
    const moved = !!prev && (prev.dueDate !== next.dueDate || prev.dueTime !== next.dueTime);
    if (patch.remindAt === undefined) {
      // A timed task reminds at its time unless Sir said otherwise; a rescheduled one follows it.
      if (!prev && dueStamp) next.remindAt = dueStamp;
      else if (moved && prev?.remindAt) {
        next.remindAt =
          dueStamp ??
          (prev.dueDate && next.dueDate
            ? shiftDays(prev.remindAt, daysBetween(prev.dueDate, next.dueDate))
            : prev.remindAt);
      }
    }
    if (next.listId && !repo.lists().some((l) => l.id === next.listId)) next.listId = null;
    const children = prev ? repo.todos().filter((t) => t.parentId === prev.id) : [];
    if (next.parentId) {
      const parent = repo.todo(next.parentId);
      if (!parent || parent.id === next.id || parent.parentId || children.length)
        throw new JarvisError('INVALID', 'bad parent', 'Subtasks go one level deep under a task.');
      next.listId = parent.listId;
    }
    next = TodoSchema.parse(next);
    const now = toStamp(new Date());
    let reminded = prev ? prev.remindAt === next.remindAt && repo.isReminded(next.id) : false;
    let rolled = false;

    if (next.status === 'done' && prev?.status !== 'done') {
      const rule = next.recurrence;
      if (rule && next.dueDate && !next.parentId) {
        // Repeating task: log this one as done and move the task on to its next date.
        repo.putTodo(
          {
            ...next,
            id: newId('td_'),
            recurrence: null,
            remindAt: null,
            completedAt: ts,
            createdAt: ts,
          },
          true,
        );
        const { count, ...open } = rule;
        const due = count === 1 ? null : nextDueDate(next.dueDate, open);
        if (due) {
          next = {
            ...next,
            status: 'todo',
            dueDate: due,
            remindAt: next.remindAt
              ? shiftDays(next.remindAt, daysBetween(next.dueDate, due))
              : null,
            recurrence: count ? { ...rule, count: count - 1 } : rule,
            completedAt: null,
          };
          // Finishing an overdue repeat can land the next one in the past: no instant reminder.
          reminded = !!next.remindAt && next.remindAt <= now;
          rolled = true;
        } else next.completedAt = ts;
      } else next.completedAt = ts;
      // Finishing a task finishes its subtasks; a repeating one starts its next round with them open.
      for (const sub of children)
        if (rolled ? sub.status === 'done' : sub.status !== 'done')
          repo.putTodo(
            {
              ...sub,
              status: rolled ? 'todo' : 'done',
              completedAt: rolled ? null : ts,
              updatedAt: ts,
            },
            true,
          );
    } else if (next.status !== 'done') next.completedAt = null;
    // Subtasks live in their parent's list.
    if (prev && prev.listId !== next.listId)
      for (const sub of children)
        repo.putTodo({ ...sub, listId: next.listId, updatedAt: ts }, repo.isReminded(sub.id));

    repo.putTodo(next, reminded);
    deps.onChange();
    return next;
  }

  // ── calendars ──
  function saveCalendar(p: {
    id?: string | undefined;
    name?: string | undefined;
    color?: string | undefined;
    visible?: boolean | undefined;
  }): Calendar {
    const all = repo.calendars();
    const prev = p.id ? all.find((c) => c.id === p.id) : undefined;
    if (p.id && !prev) throw notFound('calendar');
    const cal = CalendarSchema.parse({
      id: prev?.id ?? newId('cal_'),
      name: p.name ?? prev?.name,
      color: p.color ?? prev?.color ?? PLANNER_COLORS[all.length % PLANNER_COLORS.length],
      visible: p.visible ?? prev?.visible ?? true,
    });
    repo.putCalendar(cal, nowIso());
    deps.onChange();
    return cal;
  }

  // ── events ──
  function saveEvent(patch: EventPatch): CalEvent {
    const ts = nowIso();
    const prev = patch.id ? repo.event(patch.id) : undefined;
    if (patch.id && !prev) throw notFound('event');
    const start = toStamp(new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000));
    const base: CalEvent = prev ?? {
      id: newId('ev_'),
      calendarId: repo.calendars()[0]?.id ?? '',
      title: '',
      notes: '',
      location: '',
      start,
      end: addMinutes(start, 60),
      allDay: false,
      recurrence: null,
      exdates: [],
      reminders: [10],
      createdAt: ts,
      updatedAt: ts,
    };
    const { id: _id, ...fields } = patch;
    const next: CalEvent = { ...base, ...defined(fields), updatedAt: ts };
    if (!repo.calendars().some((c) => c.id === next.calendarId))
      throw new JarvisError('INVALID', 'calendar', 'Pick a calendar for the event.');
    if (next.allDay) {
      next.start = `${next.start.slice(0, 10)}T00:00`;
      const last = next.end.slice(0, 10) < next.start.slice(0, 10) ? next.start : next.end;
      next.end = `${last.slice(0, 10)}T23:59`;
    } else if (next.end <= next.start) next.end = addMinutes(next.start, 30);
    next.reminders = [...new Set(next.reminders)].sort((a, b) => a - b);
    const ev = EventSchema.parse(next);
    repo.putEvent(ev);
    deps.onChange();
    return ev;
  }

  /** scope: 'all' deletes the series; 'one' skips that date; 'following' ends the series before it. */
  function deleteEvent(
    id: string,
    date?: string,
    scope: 'one' | 'following' | 'all' = 'all',
  ): void {
    const ev = repo.event(id);
    if (!ev) throw notFound('event');
    const first = ev.start.slice(0, 10);
    if (!ev.recurrence || !date || scope === 'all' || (scope === 'following' && date <= first))
      repo.deleteEvent(id);
    else if (scope === 'one')
      repo.putEvent({ ...ev, exdates: [...new Set([...ev.exdates, date])] });
    else {
      const { count: _count, ...rule } = ev.recurrence;
      repo.putEvent({ ...ev, recurrence: { ...rule, until: addDays(date, -1) } });
    }
    deps.onChange();
  }

  function agenda(from: string, to: string, opts: { includeHidden?: boolean } = {}): AgendaItem[] {
    const cals = new Map(repo.calendars().map((c) => [c.id, c]));
    const lists = new Map(repo.lists().map((l) => [l.id, l.name]));
    const items: AgendaItem[] = [];
    for (const e of repo.events()) {
      const cal = cals.get(e.calendarId);
      if (!cal || (!cal.visible && !opts.includeHidden)) continue;
      for (const o of occurrencesBetween(e, `${from}T00:00`, `${to}T23:59`))
        items.push({
          kind: 'event',
          id: e.id,
          title: e.title,
          start: e.allDay ? o.date : o.start,
          end: e.allDay ? o.end.slice(0, 10) : o.end,
          allDay: e.allDay,
          where: [cal.name, e.location].filter(Boolean).join(' · '),
          done: false,
        });
    }
    for (const t of repo.todos())
      if (t.dueDate && t.dueDate >= from && t.dueDate <= to && !t.parentId)
        items.push({
          kind: 'task',
          id: t.id,
          title: t.title,
          start: t.dueTime ? `${t.dueDate}T${t.dueTime}` : t.dueDate,
          end: null,
          allDay: !t.dueTime,
          where: t.listId ? (lists.get(t.listId) ?? 'Inbox') : 'Inbox',
          done: t.status === 'done',
        });
    return items.sort((a, b) => a.start.localeCompare(b.start));
  }

  const send = (title: string, body: string): void => {
    try {
      deps.deliver(title, body);
    } catch (err) {
      log.warn({ err: String(err) }, 'reminder delivery failed');
    }
  };

  function tick(at = new Date()): void {
    const now = toStamp(at);
    const lookback = addMinutes(now, -LOOKBACK_MIN);
    for (const t of repo.dueTodoReminders(now)) {
      repo.markReminded(t.id);
      send('Task', t.dueTime ? `${t.title} (due ${t.dueTime})` : t.title);
    }
    for (const e of repo.events()) {
      if (e.reminders.length === 0) continue;
      const ahead = Math.max(...e.reminders);
      for (const o of occurrencesBetween(e, lookback, addMinutes(now, ahead)))
        for (const m of e.reminders) {
          const fireAt = addMinutes(o.start, -m);
          if (fireAt > now || fireAt <= lookback) continue;
          if (!repo.claimEventReminder(e.id, o.start, m, at.toISOString())) continue;
          const when = e.allDay
            ? m === 0
              ? 'today'
              : `in ${fmtMinutes(m)}`
            : m === 0
              ? 'starts now'
              : `in ${fmtMinutes(m)}`;
          send('Event', `${e.title} ${when}${e.location ? ` · ${e.location}` : ''}`);
        }
    }
  }

  return {
    // lists
    lists: () => repo.lists(),
    saveList,
    deleteList(id: string): void {
      repo.deleteList(id);
      deps.onChange();
    },
    // todos
    todos: () => repo.todos(),
    todo: (id: string) => repo.todo(id),
    saveTodo,
    deleteTodo(id: string): void {
      if (!repo.todo(id)) throw notFound('task');
      repo.deleteTodo(id);
      deps.onChange();
    },
    clearCompleted(): number {
      const n = repo.clearCompleted();
      deps.onChange();
      return n;
    },
    // calendars & events
    calendars: () => repo.calendars(),
    saveCalendar,
    deleteCalendar(id: string): void {
      if (repo.calendars().length <= 1)
        throw new JarvisError('INVALID', 'last calendar', 'Keep at least one calendar.');
      repo.deleteCalendar(id);
      deps.onChange();
    },
    events: () => repo.events(),
    event: (id: string) => repo.event(id),
    saveEvent,
    deleteEvent,
    agenda,
    exportIcs(calendarId?: string): string {
      return toIcs(repo.events().filter((e) => !calendarId || e.calendarId === calendarId));
    },
    importIcs(text: string, name: string): { calendar: Calendar; count: number; skipped: number } {
      const parsed = parseIcs(text);
      const ts = nowIso();
      const valid = parsed.events.flatMap((p) => {
        const ev = EventSchema.safeParse({
          ...p,
          id: newId('ev_'),
          calendarId: 'cal_pending',
          createdAt: ts,
          updatedAt: ts,
        });
        return ev.success ? [ev.data] : [];
      });
      const skipped = parsed.skipped + parsed.events.length - valid.length;
      if (valid.length === 0)
        throw new JarvisError(
          'INVALID',
          'no events',
          `No events Jarvis can read in that file${skipped ? ` (${skipped} skipped)` : ''}.`,
        );
      const calendar = tx(deps.db, () => {
        const cal = CalendarSchema.parse({
          id: newId('cal_'),
          name: name.trim().slice(0, 60) || 'Imported',
          color: PLANNER_COLORS[repo.calendars().length % PLANNER_COLORS.length],
          visible: true,
        });
        repo.putCalendar(cal, ts);
        for (const ev of valid) repo.putEvent({ ...ev, calendarId: cal.id });
        return cal;
      });
      log.info({ count: valid.length, skipped }, 'calendar imported');
      deps.onChange();
      return { calendar, count: valid.length, skipped };
    },
    tick,
    start(): void {
      const safeTick = (): void => {
        try {
          tick();
        } catch (err) {
          log.warn({ err: String(err) }, 'planner tick failed');
        }
      };
      safeTick();
      timer = setInterval(safeTick, TICK_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type Planner = ReturnType<typeof createPlanner>;
