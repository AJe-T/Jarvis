import { z } from 'zod';
import type { Db } from '../db/connection';
import { newId } from '../lib/util';

/**
 * Scheduled agents (ideas from OpenJarvis's morning digest, scheduled monitors and proactive agent):
 * a prompt Jarvis runs by itself on a schedule, in its own conversation, with the normal tools and
 * safety rules. Confirmations still need Sir; nothing runs while the app is closed.
 */

export const ScheduleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    /** 1 = Monday … 7 = Sunday; empty = every day. */
    days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  }),
  z.object({
    type: z.literal('interval'),
    minutes: z
      .number()
      .int()
      .min(15)
      .max(7 * 24 * 60),
  }),
]);
export type Schedule = z.infer<typeof ScheduleSchema>;

export const TASK_KINDS = ['briefing', 'task', 'checkin'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface TaskRow {
  id: string;
  name: string;
  kind: TaskKind;
  prompt: string;
  schedule_json: string;
  enabled: number;
  speak: number;
  save_to_vault: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_conversation_id: string | null;
  created_at: string;
}

/** ISO weekday: Monday 1 … Sunday 7. */
const isoDay = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

/** Next time after `from` (local time) the schedule fires. */
export function nextRun(s: Schedule, from: Date): Date {
  if (s.type === 'interval') return new Date(from.getTime() + s.minutes * 60_000);
  const [h, m] = s.time.split(':').map(Number) as [number, number];
  for (let add = 0; add <= 7; add++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, h, m, 0, 0);
    if (d <= from) continue;
    if (s.days.length && !s.days.includes(isoDay(d))) continue;
    return d;
  }
  return new Date(from.getTime() + 7 * 86_400_000);
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function describeSchedule(s: Schedule): string {
  if (s.type === 'interval')
    return s.minutes % 60 === 0 ? `every ${s.minutes / 60} h` : `every ${s.minutes} min`;
  const days =
    !s.days.length || s.days.length === 7
      ? 'every day'
      : s.days.join(',') === '1,2,3,4,5'
        ? 'weekdays'
        : s.days.map((d) => DAY[d]).join(', ');
  return `${days} at ${s.time}`;
}

export interface NewTask {
  name: string;
  kind: TaskKind;
  prompt: string;
  schedule: Schedule;
  enabled?: boolean;
  speak?: boolean;
  saveToVault?: boolean;
}

export function createTasksRepo(db: Db) {
  const get = (id: string): TaskRow | undefined =>
    db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as unknown as
      TaskRow | undefined;
  return {
    get,
    list(): TaskRow[] {
      return db
        .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at')
        .all() as unknown as TaskRow[];
    },
    due(now: Date): TaskRow[] {
      return db
        .prepare(
          'SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?',
        )
        .all(now.toISOString()) as unknown as TaskRow[];
    },
    upsert(t: NewTask & { id?: string | undefined }, now = new Date()): TaskRow {
      const id = t.id ?? newId('task_');
      const existing = get(id);
      const next = (t.enabled ?? true) ? nextRun(t.schedule, now).toISOString() : null;
      db.prepare(
        `INSERT INTO scheduled_tasks (id, name, kind, prompt, schedule_json, enabled, speak, save_to_vault, next_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, prompt = excluded.prompt,
           schedule_json = excluded.schedule_json, enabled = excluded.enabled, speak = excluded.speak,
           save_to_vault = excluded.save_to_vault, next_run_at = excluded.next_run_at`,
      ).run(
        id,
        t.name,
        t.kind,
        t.prompt,
        JSON.stringify(t.schedule),
        (t.enabled ?? true) ? 1 : 0,
        t.speak ? 1 : 0,
        t.saveToVault ? 1 : 0,
        next,
        existing?.created_at ?? now.toISOString(),
      );
      return get(id) as TaskRow;
    },
    markRun(
      id: string,
      at: Date,
      status: string,
      conversationId: string | null,
      next: Date | null,
    ): void {
      db.prepare(
        'UPDATE scheduled_tasks SET last_run_at = ?, last_status = ?, last_conversation_id = ?, next_run_at = ? WHERE id = ?',
      ).run(at.toISOString(), status, conversationId, next ? next.toISOString() : null, id);
    },
    setStatus(id: string, status: string): void {
      db.prepare('UPDATE scheduled_tasks SET last_status = ? WHERE id = ?').run(status, id);
    },
    remove(id: string): boolean {
      return Number(db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id).changes) > 0;
    },
  };
}

export type TasksRepo = ReturnType<typeof createTasksRepo>;

export const MORNING_BRIEFING_PROMPT = `Give Sir his morning briefing. Use your tools: today's weather in his home town (get_weather), his reminders for today (list_reminders), the top headlines from his news feeds (read_feed), and anything in memory that matters today. Start with a warm one-line greeting with the date. Keep the spoken part under 45 seconds; put details on screen.`;
