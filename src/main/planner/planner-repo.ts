import type { CalEvent, Calendar, Recurrence, Todo, TodoList } from '@shared/planner';
import type { Db, SqlValue } from '../db/connection';

/** SQLite rows for Tasks and Calendar (migration 010). JSON columns hold arrays and repeat rules. */

interface TodoRow {
  id: string;
  list_id: string | null;
  parent_id: string | null;
  title: string;
  notes: string;
  status: Todo['status'];
  priority: number;
  due_date: string | null;
  due_time: string | null;
  duration_min: number | null;
  remind_at: string | null;
  reminded: number;
  recurrence_json: string | null;
  tags_json: string;
  starred: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface EventRow {
  id: string;
  calendar_id: string;
  title: string;
  notes: string;
  location: string;
  start_at: string;
  end_at: string;
  all_day: number;
  recurrence_json: string | null;
  exdates_json: string;
  reminders_json: string;
  created_at: string;
  updated_at: string;
}

function json<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const toTodo = (r: TodoRow): Todo => ({
  id: r.id,
  listId: r.list_id,
  parentId: r.parent_id,
  title: r.title,
  notes: r.notes,
  status: r.status,
  priority: r.priority,
  dueDate: r.due_date,
  dueTime: r.due_time,
  durationMin: r.duration_min,
  remindAt: r.remind_at,
  recurrence: json<Recurrence | null>(r.recurrence_json, null),
  tags: json<string[]>(r.tags_json, []),
  starred: r.starred === 1,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
});

const toEvent = (r: EventRow): CalEvent => ({
  id: r.id,
  calendarId: r.calendar_id,
  title: r.title,
  notes: r.notes,
  location: r.location,
  start: r.start_at,
  end: r.end_at,
  allDay: r.all_day === 1,
  recurrence: json<Recurrence | null>(r.recurrence_json, null),
  exdates: json<string[]>(r.exdates_json, []),
  reminders: json<number[]>(r.reminders_json, []),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const TODO_COLS =
  'id, list_id, parent_id, title, notes, status, priority, due_date, due_time, duration_min, remind_at, reminded, recurrence_json, tags_json, starred, sort_order, created_at, updated_at, completed_at';
const EVENT_COLS =
  'id, calendar_id, title, notes, location, start_at, end_at, all_day, recurrence_json, exdates_json, reminders_json, created_at, updated_at';

/** INSERT … ON CONFLICT DO UPDATE (never REPLACE: that would delete the row and cascade to subtasks). */
function upsertSql(table: string, cols: string): string {
  const names = cols.split(', ');
  return `INSERT INTO ${table} (${cols}) VALUES (${names.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${names
    .filter((n) => n !== 'id' && n !== 'created_at')
    .map((n) => `${n} = excluded.${n}`)
    .join(', ')}`;
}

export function createPlannerRepo(db: Db) {
  const all = <T>(sql: string, ...args: SqlValue[]): T[] =>
    db.prepare(sql).all(...args) as unknown as T[];

  return {
    lists: (): TodoList[] =>
      all<{
        id: string;
        name: string;
        color: string;
        icon: string;
        sort_order: number;
        description: string;
        wip_limit: number | null;
        archived: number;
      }>('SELECT * FROM todo_lists ORDER BY sort_order, created_at').map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        icon: r.icon,
        sortOrder: r.sort_order,
        description: r.description,
        wipLimit: r.wip_limit,
        archived: r.archived === 1,
      })),
    putList(l: TodoList, now: string): void {
      db.prepare(
        'INSERT INTO todo_lists (id, name, color, icon, sort_order, description, wip_limit, archived, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, icon = excluded.icon, sort_order = excluded.sort_order, description = excluded.description, wip_limit = excluded.wip_limit, archived = excluded.archived',
      ).run(
        l.id,
        l.name,
        l.color,
        l.icon,
        l.sortOrder,
        l.description,
        l.wipLimit,
        l.archived ? 1 : 0,
        now,
      );
    },
    deleteList(id: string): void {
      db.prepare('DELETE FROM todo_lists WHERE id = ?').run(id);
    },

    todos: (): Todo[] =>
      all<TodoRow>(`SELECT * FROM todos ORDER BY sort_order, created_at LIMIT 20000`).map(toTodo),
    todo(id: string): Todo | undefined {
      const r = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
      return r ? toTodo(r) : undefined;
    },
    putTodo(t: Todo, reminded: boolean): void {
      db.prepare(upsertSql('todos', TODO_COLS)).run(
        t.id,
        t.listId,
        t.parentId,
        t.title,
        t.notes,
        t.status,
        t.priority,
        t.dueDate,
        t.dueTime,
        t.durationMin,
        t.remindAt,
        reminded ? 1 : 0,
        t.recurrence ? JSON.stringify(t.recurrence) : null,
        JSON.stringify(t.tags),
        t.starred ? 1 : 0,
        t.sortOrder,
        t.createdAt,
        t.updatedAt,
        t.completedAt,
      );
    },
    deleteTodo(id: string): void {
      db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    },
    clearCompleted(): number {
      return Number(
        // A done task that still has an open subtask stays (deleting it would cascade to that subtask).
        db
          .prepare(
            "DELETE FROM todos WHERE status = 'done' AND parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM todos c WHERE c.parent_id = todos.id AND c.status != 'done')",
          )
          .run().changes,
      );
    },
    dueTodoReminders: (now: string): Todo[] =>
      all<TodoRow>(
        "SELECT * FROM todos WHERE reminded = 0 AND remind_at IS NOT NULL AND remind_at <= ? AND status != 'done'",
        now,
      ).map(toTodo),
    isReminded: (id: string): boolean =>
      (db.prepare('SELECT reminded FROM todos WHERE id = ?').get(id) as { reminded?: number })
        ?.reminded === 1,
    markReminded(id: string): void {
      db.prepare('UPDATE todos SET reminded = 1 WHERE id = ?').run(id);
    },

    calendars: (): Calendar[] =>
      all<{ id: string; name: string; color: string; visible: number }>(
        'SELECT * FROM calendars ORDER BY created_at',
      ).map((r) => ({ id: r.id, name: r.name, color: r.color, visible: r.visible === 1 })),
    putCalendar(c: Calendar, now: string): void {
      db.prepare(
        'INSERT INTO calendars (id, name, color, visible, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, visible = excluded.visible',
      ).run(c.id, c.name, c.color, c.visible ? 1 : 0, now);
    },
    deleteCalendar(id: string): void {
      db.prepare('DELETE FROM calendars WHERE id = ?').run(id);
    },

    events: (): CalEvent[] =>
      all<EventRow>('SELECT * FROM events ORDER BY start_at LIMIT 20000').map(toEvent),
    event(id: string): CalEvent | undefined {
      const r = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
      return r ? toEvent(r) : undefined;
    },
    putEvent(e: CalEvent): void {
      db.prepare(upsertSql('events', EVENT_COLS)).run(
        e.id,
        e.calendarId,
        e.title,
        e.notes,
        e.location,
        e.start,
        e.end,
        e.allDay ? 1 : 0,
        e.recurrence ? JSON.stringify(e.recurrence) : null,
        JSON.stringify(e.exdates),
        JSON.stringify(e.reminders),
        e.createdAt,
        e.updatedAt,
      );
    },
    deleteEvent(id: string): void {
      db.prepare('DELETE FROM events WHERE id = ?').run(id);
    },
    /** True the first time an occurrence's reminder is claimed. */
    claimEventReminder(eventId: string, occurrence: string, minutes: number, now: string): boolean {
      return (
        Number(
          db
            .prepare(
              'INSERT OR IGNORE INTO event_reminders_fired (event_id, occurrence, minutes, fired_at) VALUES (?, ?, ?, ?)',
            )
            .run(eventId, occurrence, minutes, now).changes,
        ) > 0
      );
    },
  };
}

export type PlannerRepo = ReturnType<typeof createPlannerRepo>;
