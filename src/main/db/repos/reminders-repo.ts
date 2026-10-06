import { newId, nowIso } from '../../lib/util';
import type { Db } from '../connection';

export interface ReminderRow {
  id: string;
  text: string;
  due_at: string;
  recurrence: string | null;
  status: 'scheduled' | 'fired' | 'dismissed' | 'cancelled';
  speak: number;
  created_from_conversation_id: string | null;
  created_at: string;
  fired_at: string | null;
}

export function createRemindersRepo(db: Db) {
  const get = (id: string): ReminderRow | undefined =>
    db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as ReminderRow | undefined;
  return {
    get,
    create(text: string, dueAt: Date, conversationId: string | null): ReminderRow {
      const id = newId('r_');
      db.prepare(
        "INSERT INTO reminders (id, text, due_at, status, speak, created_from_conversation_id, created_at) VALUES (?, ?, ?, 'scheduled', 1, ?, ?)",
      ).run(id, text, dueAt.toISOString(), conversationId, nowIso());
      return get(id) as ReminderRow;
    },
    due(now: Date): ReminderRow[] {
      return db
        .prepare(
          "SELECT * FROM reminders WHERE status = 'scheduled' AND due_at <= ? ORDER BY due_at",
        )
        .all(now.toISOString()) as unknown as ReminderRow[];
    },
    upcoming(): ReminderRow[] {
      return db
        .prepare("SELECT * FROM reminders WHERE status = 'scheduled' ORDER BY due_at")
        .all() as unknown as ReminderRow[];
    },
    recent(limit = 50): ReminderRow[] {
      return db
        .prepare('SELECT * FROM reminders ORDER BY due_at DESC LIMIT ?')
        .all(limit) as unknown as ReminderRow[];
    },
    setStatus(id: string, status: ReminderRow['status']): void {
      db.prepare(
        `UPDATE reminders SET status = ?, fired_at = CASE WHEN ? = 'fired' THEN ? ELSE fired_at END WHERE id = ?`,
      ).run(status, status, nowIso(), id);
    },
  };
}

export type RemindersRepo = ReturnType<typeof createRemindersRepo>;
