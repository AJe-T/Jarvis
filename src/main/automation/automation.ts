import { z } from 'zod';
import { errorMessage } from '../errors';
import { localDay } from '../lib/util';
import { logger } from '../logging/logger';
import type { Services } from '../services';
import { defineTool, ok, type Tool } from '../tools/types';
import { createFeedTools } from './feeds';
import { awayReport } from './watchdog';
import { IGNORED_LIMIT, createFollowThrough } from './follow-through';
import {
  MORNING_BRIEFING_PROMPT,
  ScheduleSchema,
  TASK_KINDS,
  createTasksRepo,
  describeSchedule,
  nextRun,
  type Schedule,
  type TaskRow,
} from './tasks';

const TICK_MS = 30_000;
/** A run missed by more than this (PC asleep, app closed) is skipped, not run late. */
const LATE_LIMIT_MS = 2 * 3_600_000;
const NOTHING = /^\s*NOTHING\.?\s*$/i;
/** "When Jarvis starts" automations wait for startup (models, connections) to settle first. */
const STARTUP_GRACE_MS = 20_000;
/** Failed runs in a row before an automation switches itself off (idea from Open Dots / Paperclip). */
export const MAX_FAILURES = 3;

export const schedOf = (t: TaskRow): Schedule => ScheduleSchema.parse(JSON.parse(t.schedule_json));

/**
 * Scheduled agents (ideas from OpenJarvis): runs due tasks as ordinary turns in their own conversation,
 * then notifies, speaks (if voice is on) and optionally saves the result to Obsidian.
 */
export function createAutomation(
  s: Services,
  deps: { writeNote?(rel: string, markdown: string): Promise<unknown>; now?(): Date } = {},
) {
  const repo = createTasksRepo(s.db);
  const now = deps.now ?? (() => new Date());
  const log = logger.child({ module: 'automation' });
  const pending = new Map<string, { task: TaskRow; conversationId: string }>(); // turnId → run
  // ponytail: in memory, so a restart forgets the streak; a column if daily tasks need it.
  const failStreak = new Map<string, number>();
  const overCap = new Map<string, number>(); // turnId → cost when it was stopped
  // Check-ins and tasks Sir keeps not answering: suggest pausing them, once (ruflo dream-cycle lesson).
  const followThrough = createFollowThrough((taskId) => {
    const t = repo.get(taskId);
    if (!t?.enabled) return;
    s.emit('notify', {
      level: 'info',
      message: `You haven't answered "${t.name}" the last ${IGNORED_LIMIT} times. If it isn't useful, pause it in Automations.`,
    });
  });
  s.orchestrator.onTurnStart((info) => {
    if (info.purpose === 'chat') followThrough.replied(info.conversationId);
  });

  /** Records a failed run; the third in a row pauses the automation and tells Sir. */
  function failed(task: TaskRow, status: string, pauseNow = false): void {
    const streak = (failStreak.get(task.id) ?? 0) + 1;
    if (!pauseNow && streak < MAX_FAILURES) {
      failStreak.set(task.id, streak);
      repo.setStatus(task.id, status);
      return;
    }
    failStreak.delete(task.id);
    repo.pause(task.id, `paused: ${status}`);
    s.audit.append('system', 'task.paused', { id: task.id, name: task.name, status });
    s.emit('tasks:changed', {});
    const why = pauseNow ? status : `${MAX_FAILURES} runs in a row failed (${status})`;
    s.emit('notify', { level: 'warn', message: `${task.name} is paused: ${why}.` });
    s.os.notify(`${task.name} paused`, `${why}. Switch it back on in Settings → Automations.`);
  }

  /** Stops automation runs that went over the per-run cost cap (checked every tick). */
  function enforceCap(): void {
    const cap = s.settings.get('budget.automationRunUsd');
    if (cap <= 0) return;
    for (const [turnId, { conversationId }] of pending) {
      const cost = s.usageRepo.conversationCost(conversationId);
      if (cost < cap || overCap.has(turnId)) continue;
      overCap.set(turnId, cost);
      s.orchestrator.cancel(turnId);
    }
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  const startupTimers: Array<ReturnType<typeof setTimeout>> = [];

  function run(task: TaskRow, at = now()): string {
    const speak =
      task.speak === 1 &&
      s.settings.get('voice.mode') !== 'off' &&
      s.settings.get('quiet.until') <= now().getTime();
    const extra =
      task.kind === 'checkin'
        ? '\n\nIf there is nothing worth telling sir right now, reply with exactly NOTHING.'
        : '';
    const { conversationId, turnId } = s.orchestrator.send({
      text: `⏰ Scheduled "${task.name}": ${task.prompt}${extra}`,
      source: speak ? 'voice' : 'text',
      purpose: task.kind === 'briefing' ? 'briefing' : 'task',
    });
    pending.set(turnId, { task, conversationId });
    repo.markRun(
      task.id,
      at,
      'running',
      conversationId,
      task.enabled ? nextRun(schedOf(task), at) : null,
    );
    s.audit.append('system', 'task.run', { id: task.id, name: task.name });
    return conversationId;
  }

  function tick(): void {
    const at = now();
    enforceCap();
    for (const task of repo.due(at)) {
      const late = at.getTime() - new Date(task.next_run_at ?? 0).getTime();
      if (late > LATE_LIMIT_MS) {
        repo.markRun(
          task.id,
          at,
          'missed (Jarvis was not running)',
          task.last_conversation_id,
          nextRun(schedOf(task), at),
        );
        continue;
      }
      try {
        run(task, at);
      } catch (err) {
        log.warn({ err: errorMessage(err), task: task.id }, 'scheduled task failed to start');
        repo.markRun(task.id, at, `failed: ${errorMessage(err)}`, null, nextRun(schedOf(task), at));
        failed(task, `failed: ${errorMessage(err)}`);
      }
    }
  }

  s.orchestrator.onTurnEnd(async (turn) => {
    const run = pending.get(turn.turnId);
    if (!run) return;
    const { task } = run;
    pending.delete(turn.turnId);
    const report = awayReport(task.name, turn.watch);
    if (report) {
      s.audit.append('system', 'task.watchdog', {
        id: task.id,
        name: task.name,
        injection: Boolean(turn.watch?.injection),
        blocked: turn.watch?.blocked.length ?? 0,
        unanswered: turn.watch?.unanswered.length ?? 0,
      });
      s.emit('notify', { level: 'warn', message: report });
      if (s.settings.get('quiet.until') <= now().getTime())
        s.os.notify(`${task.name}: check what happened`, report.slice(0, 240));
    }
    const cost = overCap.get(turn.turnId);
    overCap.delete(turn.turnId);
    if (cost !== undefined) {
      const cap = s.settings.get('budget.automationRunUsd');
      failed(task, `stopped at $${cost.toFixed(2)}, over its $${cap.toFixed(2)} per-run cap`, true);
      return;
    }
    if (turn.outcome === 'aborted') {
      repo.setStatus(task.id, 'stopped');
      return;
    }
    if (turn.outcome !== 'end_turn' && turn.outcome !== 'max_iterations') {
      failed(task, 'failed');
      return;
    }
    failStreak.delete(task.id);
    const reply = turn.replyText.replace(/<\/?spoken>/g, '').trim();
    if (task.kind === 'checkin' && NOTHING.test(reply)) {
      repo.setStatus(task.id, 'nothing to report');
      s.conversations.delete(turn.conversationId);
      return;
    }
    repo.setStatus(task.id, 'done');
    // Briefings are meant to be listened to; check-ins and tasks expect a reaction.
    if (task.kind !== 'briefing') followThrough.delivered(task.id, turn.conversationId);
    s.emit('notify', { level: 'info', message: `${task.name} is ready.` });
    if (s.settings.get('quiet.until') <= now().getTime())
      s.os.notify(task.name, reply.slice(0, 180));
    if (task.save_to_vault === 1 && deps.writeNote) {
      const rel = `Briefings/${localDay()} ${task.name.replace(/[\\/:*?"<>|.]/g, '').trim()}.md`;
      await deps
        .writeNote(
          rel,
          `---\ntype: briefing\ntask: ${task.name}\n---\n# ${task.name} — ${localDay()}\n\n${reply}\n`,
        )
        .catch((err: unknown) =>
          log.warn({ err: errorMessage(err) }, 'could not save briefing to the vault'),
        );
    }
  });

  const view = (t: TaskRow): string =>
    `[${t.id}] ${t.name} (${t.kind}, ${describeSchedule(schedOf(t))}${t.enabled ? '' : ', off'}) — last: ${t.last_status ?? 'never run'}`;

  const tools: Tool[] = [
    defineTool({
      name: 'schedule_task',
      description:
        'Create a task Jarvis runs by itself, e.g. "every weekday at 8:00 give me a briefing", "every Friday 17:00 summarise my week", "on the 1st of each month check my bills", "tomorrow at 9 remind me why I opened this project" (once), or "each time you start, tell me what is overdue" (startup). kind: briefing (spoken/saved digest), task (do and report), checkin (proactive: report only if something is worth saying). Times are local, 24 h; once.at is local "YYYY-MM-DDTHH:mm".',
      input: z.object({
        name: z.string().min(2).max(60),
        prompt: z
          .string()
          .min(5)
          .max(2000)
          .describe('What to do each time, written as an instruction to yourself'),
        kind: z.enum(TASK_KINDS).default('task'),
        schedule: ScheduleSchema,
        speak: z.boolean().default(false),
        save_to_vault: z.boolean().default(false),
      }),
      tier: 'CONFIRM',
      summarize: ({ name, schedule }) => `Schedule "${name}" (${describeSchedule(schedule)})`,
      confirm: ({ name, prompt, schedule }) => ({
        title: `Run "${name}" ${describeSchedule(schedule)}?`,
        actionLabel: 'Schedule it',
        details: prompt,
        detailsKind: 'text',
      }),
      async run(i) {
        const t = repo.upsert({
          name: i.name,
          kind: i.kind,
          prompt: i.prompt,
          schedule: i.schedule,
          speak: i.speak,
          saveToVault: i.save_to_vault,
        });
        s.emit('tasks:changed', {});
        const next = t.next_run_at
          ? `Next run: ${new Date(t.next_run_at).toLocaleString('en-GB')}.`
          : `Runs ${describeSchedule(i.schedule)}.`;
        return ok(`Scheduled. ${next} ${view(t)}`);
      },
    }),
    defineTool({
      name: 'list_scheduled_tasks',
      description: "Sir's scheduled tasks and briefings, with their schedule and last result.",
      input: z.object({}).strict(),
      tier: 'SAFE',
      summarize: () => 'List scheduled tasks',
      async run() {
        const all = repo.list();
        return ok(all.length ? all.map(view).join('\n') : 'No scheduled tasks.');
      },
    }),
    defineTool({
      name: 'cancel_scheduled_task',
      description: 'Delete a scheduled task by id (from list_scheduled_tasks).',
      input: z.object({ id: z.string().regex(/^task_[\w-]+$/) }),
      tier: 'CONFIRM',
      destructive: true,
      summarize: ({ id }) => `Delete scheduled task ${repo.get(id)?.name ?? id}`,
      async run({ id }) {
        const ok_ = repo.remove(id);
        s.emit('tasks:changed', {});
        return ok(ok_ ? 'Deleted.' : 'No task with that id.');
      },
    }),
    ...createFeedTools({ settings: s.settings, ...(s.fetch ? { fetch: s.fetch } : {}) }),
  ];
  for (const t of tools) s.registry.register(t);

  return {
    repo,
    tick,
    runNow: (id: string): string | null => {
      const t = repo.get(id);
      return t ? run(t) : null;
    },
    /** Adds the (disabled) morning briefing preset once, so Sir only has to switch it on. */
    ensureMorningBriefing(): void {
      if (repo.list().some((t) => t.kind === 'briefing')) return;
      repo.upsert({
        name: 'Morning briefing',
        kind: 'briefing',
        prompt: MORNING_BRIEFING_PROMPT,
        schedule: { type: 'daily', time: '07:30', days: [] },
        enabled: false,
        speak: true,
        saveToVault: true,
      });
    },
    start(): void {
      if (timer) return;
      tick();
      timer = setInterval(tick, TICK_MS);
      // "When Jarvis starts" automations: once per start, after their delay (and the startup settling).
      for (const task of repo.list()) {
        const sched = schedOf(task);
        if (!task.enabled || sched.type !== 'startup') continue;
        const t = setTimeout(
          () => {
            const fresh = repo.get(task.id);
            if (!fresh?.enabled) return;
            try {
              run(fresh);
            } catch (err) {
              log.warn({ err: errorMessage(err), task: task.id }, 'startup task failed to start');
            }
          },
          STARTUP_GRACE_MS + sched.delayMinutes * 60_000,
        );
        startupTimers.push(t);
      }
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
      for (const t of startupTimers.splice(0)) clearTimeout(t);
    },
  };
}

export type Automation = ReturnType<typeof createAutomation>;
