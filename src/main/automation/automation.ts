import { z } from 'zod';
import { errorMessage } from '../errors';
import { localDay } from '../lib/util';
import { logger } from '../logging/logger';
import type { Services } from '../services';
import { defineTool, ok, type Tool } from '../tools/types';
import { createFeedTools } from './feeds';
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
  const pending = new Map<string, TaskRow>(); // turnId → task
  let timer: ReturnType<typeof setInterval> | null = null;

  function run(task: TaskRow, at = now()): string {
    const speak = task.speak === 1 && s.settings.get('voice.mode') !== 'off';
    const extra =
      task.kind === 'checkin'
        ? '\n\nIf there is nothing worth telling sir right now, reply with exactly NOTHING.'
        : '';
    const { conversationId, turnId } = s.orchestrator.send({
      text: `⏰ Scheduled "${task.name}": ${task.prompt}${extra}`,
      source: speak ? 'voice' : 'text',
      purpose: task.kind === 'briefing' ? 'briefing' : 'task',
    });
    pending.set(turnId, task);
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
      }
    }
  }

  s.orchestrator.onTurnEnd(async (turn) => {
    const task = pending.get(turn.turnId);
    if (!task) return;
    pending.delete(turn.turnId);
    if (turn.outcome !== 'end_turn' && turn.outcome !== 'max_iterations') {
      repo.setStatus(task.id, turn.outcome === 'aborted' ? 'stopped' : 'failed');
      return;
    }
    const reply = turn.replyText.replace(/<\/?spoken>/g, '').trim();
    if (task.kind === 'checkin' && NOTHING.test(reply)) {
      repo.setStatus(task.id, 'nothing to report');
      s.conversations.delete(turn.conversationId);
      return;
    }
    repo.setStatus(task.id, 'done');
    s.emit('notify', { level: 'info', message: `${task.name} is ready.` });
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
        'Create a recurring task Jarvis runs by itself, e.g. "every weekday at 8:00 give me a briefing" or "every Friday 17:00 summarise my week". kind: briefing (spoken/saved digest), task (do and report), checkin (proactive: report only if something is worth saying). Times are local, 24 h.',
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
        return ok(
          `Scheduled. Next run: ${new Date(t.next_run_at ?? '').toLocaleString('en-GB')}. ${view(t)}`,
        );
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
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type Automation = ReturnType<typeof createAutomation>;
