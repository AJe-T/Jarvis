import type { CalEvent, Todo } from '@shared/planner';
import { addDays, addMinutes, occurrencesBetween, toStamp } from '@shared/planner-time';
import type { Schedule } from '@shared/schedule';
import type { Db } from '../db/connection';

/**
 * Event triggers for automations (2.67): run when something happens, not at a time.
 * - beforeEvent: N minutes before a calendar event starts (all-day events never fire it).
 * - taskOverdue: when a to-do passes its due time (a date without a time is overdue the next day).
 * - newFile: when a file appears in a folder Sir allowed.
 *
 * check() returns what happened as lines of text, or null. It fires once per event, task and file:
 * calendar and task firings are remembered in `automation_fired`, files in memory (the first look
 * at a folder only notes what is there, so a restart never reports old files as new).
 */

const KEEP_FIRED_DAYS = 7;
const MAX_LINES = 20;
const MAX_FOLDER_NAMES = 5000;
/** Downloads in progress and Office lock files are not "a new file" yet. */
const TEMP_FILE = /(\.(crdownload|part|partial|download|tmp)$)|(^~\$)|(^\.)/i;

export type EventSchedule = Extract<Schedule, { type: 'beforeEvent' | 'taskOverdue' | 'newFile' }>;

export const isEventSchedule = (s: Schedule): s is EventSchedule =>
  s.type === 'beforeEvent' || s.type === 'taskOverdue' || s.type === 'newFile';

export interface TriggerDeps {
  db: Db;
  events(): CalEvent[];
  todos(): Todo[];
  /** File names directly inside the folder, or null when it is not allowed or cannot be read. */
  listFolder(folder: string): Promise<string[] | null>;
}

export type Triggers = ReturnType<typeof createTriggers>;

export function createTriggers(d: TriggerDeps) {
  const seenFiles = new Map<string, Set<string>>(); // task id → names already in its folder

  const hasFired = (taskId: string, key: string): boolean =>
    d.db
      .prepare('SELECT 1 FROM automation_fired WHERE task_id = ? AND key = ?')
      .get(taskId, key) !== undefined;
  const markFired = (taskId: string, key: string, at: Date): void => {
    d.db
      .prepare('INSERT OR IGNORE INTO automation_fired (task_id, key, at) VALUES (?, ?, ?)')
      .run(taskId, key, at.toISOString());
  };

  function upcomingEvents(taskId: string, minutes: number, at: Date): string[] {
    const from = toStamp(at);
    const to = addMinutes(from, minutes);
    const lines: string[] = [];
    for (const ev of d.events()) {
      if (ev.allDay) continue;
      for (const occ of occurrencesBetween(ev, from, to)) {
        const key = `${ev.id}@${occ.start}`;
        if (occ.start < from || occ.start > to || hasFired(taskId, key)) continue;
        markFired(taskId, key, at);
        const where = ev.location ? `, at ${ev.location}` : '';
        const notes = ev.notes ? `. Notes: ${ev.notes.slice(0, 300)}` : '';
        lines.push(`Calendar event "${ev.title}" starts at ${occ.start.slice(11)}${where}${notes}`);
      }
    }
    return lines;
  }

  function newlyOverdue(taskId: string, at: Date): string[] {
    const now = toStamp(at);
    const dayAgo = addMinutes(now, -24 * 60);
    const lines: string[] = [];
    for (const t of d.todos()) {
      if (t.status === 'done' || !t.dueDate) continue;
      // A date without a time is overdue when that day is over.
      const due = t.dueTime ? `${t.dueDate}T${t.dueTime}` : `${addDays(t.dueDate, 1)}T00:00`;
      const key = `${t.id}@${due}`;
      if (due > now || due < dayAgo || hasFired(taskId, key)) continue;
      markFired(taskId, key, at);
      lines.push(
        `Task "${t.title}" is overdue (was due ${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''})`,
      );
    }
    return lines;
  }

  async function newFiles(taskId: string, folder: string): Promise<string[]> {
    const all = await d.listFolder(folder);
    if (!all) return [];
    const names = all.filter((n) => !TEMP_FILE.test(n)).slice(0, MAX_FOLDER_NAMES);
    const before = seenFiles.get(taskId);
    seenFiles.set(taskId, new Set(names));
    if (!before) return [];
    return names.filter((n) => !before.has(n)).map((n) => `New file in ${folder}: ${n}`);
  }

  return {
    /** What just happened for this automation, as text for its run; null when nothing did. */
    async check(taskId: string, sched: EventSchedule, at: Date): Promise<string | null> {
      const lines =
        sched.type === 'beforeEvent'
          ? upcomingEvents(taskId, sched.minutes, at)
          : sched.type === 'taskOverdue'
            ? newlyOverdue(taskId, at)
            : await newFiles(taskId, sched.folder);
      if (lines.length === 0) return null;
      const more = lines.length > MAX_LINES ? [`… and ${lines.length - MAX_LINES} more`] : [];
      return [...lines.slice(0, MAX_LINES), ...more].join('\n');
    },
    /** A deleted or changed automation starts fresh (its folder is looked at anew). */
    forget(taskId: string): void {
      seenFiles.delete(taskId);
    },
    prune(at: Date): void {
      const cutoff = new Date(at.getTime() - KEEP_FIRED_DAYS * 86_400_000).toISOString();
      d.db.prepare('DELETE FROM automation_fired WHERE at < ?').run(cutoff);
    },
  };
}
