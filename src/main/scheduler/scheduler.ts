import type { ReminderRow, RemindersRepo } from '../db/repos/reminders-repo';
import type { Logger } from '../logging/logger';

const TICK_MS = 5_000;

/** App-flow.md §10: fires due reminders (even while the window is hidden); overdue ones at startup are "missed". */
export function createScheduler(deps: {
  repo: RemindersRepo;
  onFire(reminder: ReminderRow, missed: boolean): void;
  onChange?(): void;
  logger: Logger;
}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const log = deps.logger.child({ module: 'scheduler' });

  function fireDue(missed: boolean): void {
    for (const r of deps.repo.due(new Date())) {
      deps.repo.setStatus(r.id, 'fired');
      try {
        deps.onFire(r, missed);
      } catch (err) {
        log.warn({ err: String(err), id: r.id }, 'reminder delivery failed');
      }
    }
  }

  return {
    start(): void {
      fireDue(true);
      timer = setInterval(() => fireDue(false), TICK_MS);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    add(text: string, dueAt: Date, conversationId: string | null): ReminderRow {
      const r = deps.repo.create(text, dueAt, conversationId);
      deps.onChange?.();
      return r;
    },
    cancel(id: string): boolean {
      const r = deps.repo.get(id);
      if (r?.status !== 'scheduled') return false;
      deps.repo.setStatus(id, 'cancelled');
      deps.onChange?.();
      return true;
    },
    upcoming: () => deps.repo.upcoming(),
    tick: () => fireDue(false),
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
