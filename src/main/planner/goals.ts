import { z } from 'zod';
import { LocalDate, type Todo } from '@shared/planner';
import { parseLocal } from '@shared/planner-time';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import type { Planner } from './planner';
import { human } from './planner-tools';

/**
 * Long-term goals (idea from ruflo's goals plugin: horizons with milestones and drift detection; our
 * own code on top of Tasks). A goal is a task in the "Goals" list, its milestones are its subtasks
 * and its due date is the target. Progress is compared with the time that has passed, so a goal that
 * falls behind shows up before its deadline.
 */
export const GOALS_LIST = 'Goals';
/** Milestones may trail the calendar by this much before a goal counts as behind. */
const SLACK = 0.15;
const DAY_MS = 86_400_000;

export type GoalStatus = 'done' | 'on track' | 'behind' | 'overdue' | 'no target date';

export interface GoalProgress {
  done: number;
  total: number;
  /** Share of the time between setting the goal and its target that has passed (0–1). */
  elapsed: number | null;
  status: GoalStatus;
}

export function goalProgress(goal: Todo, milestones: Todo[], now: Date): GoalProgress {
  const total = milestones.length;
  const done = milestones.filter((m) => m.status === 'done').length;
  if (goal.status === 'done') return { done, total, elapsed: null, status: 'done' };
  if (!goal.dueDate) return { done, total, elapsed: null, status: 'no target date' };
  const start = new Date(goal.createdAt).getTime();
  // The whole target day counts: due "2026-12-31" ends at midnight after it.
  const end = parseLocal(goal.dueDate).getTime() + DAY_MS;
  if (now.getTime() >= end) return { done, total, elapsed: 1, status: 'overdue' };
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / Math.max(1, end - start)));
  // Without milestones there is nothing to measure until the date passes.
  const behind = total > 0 && done / total + SLACK < elapsed;
  return { done, total, elapsed, status: behind ? 'behind' : 'on track' };
}

export function goalLine(goal: Todo, p: GoalProgress): string {
  const target = goal.dueDate ? `, target ${human(goal.dueDate)}` : '';
  const steps = p.total ? `${p.done}/${p.total} milestones` : 'no milestones';
  const time =
    p.elapsed !== null && p.status !== 'done'
      ? `, ${Math.round(p.elapsed * 100)}% of the time gone`
      : '';
  return `${goal.id} ${goal.title} — ${p.status} (${steps}${time}${target})`;
}

export function createGoalTools(planner: Planner, now: () => Date = () => new Date()): Tool[] {
  const goalsListId = (create: boolean): string | null => {
    const found = planner.lists().find((l) => l.name.toLowerCase() === GOALS_LIST.toLowerCase());
    if (found || !create) return found?.id ?? null;
    return planner.saveList({
      name: GOALS_LIST,
      icon: '🎯',
      description: 'Long-term goals; subtasks are milestones.',
    }).id;
  };

  return [
    defineTool({
      name: 'goals',
      description:
        'Sir\'s long-term goals ("run a half marathon by March", "ship Jarvis 3.0 this year"). action=list shows each goal with milestones done, how much of the time has passed and whether it is on track, behind or overdue. action=set adds a goal with a target date and its milestones (they become subtasks in the Goals list of Tasks). Tick off or add milestones with the tasks tool (complete by title; add with parentId = the goal\'s id).',
      input: z.object({
        action: z.enum(['list', 'set']),
        title: z.string().trim().min(2).max(200).optional(),
        why: z.string().max(1000).optional(),
        target: LocalDate.optional(),
        milestones: z.array(z.string().trim().min(2).max(200)).max(20).default([]),
      }),
      tier: 'SAFE',
      timeoutMs: 5_000,
      summarize: (i) => (i.action === 'set' ? `Set goal "${i.title ?? ''}"` : 'Look at goals'),
      async run(i) {
        if (i.action === 'set') {
          if (!i.title) return fail('Give the goal.');
          const listId = goalsListId(true);
          const goal = planner.saveTodo({
            title: i.title,
            notes: i.why ?? '',
            listId,
            dueDate: i.target ?? null,
            priority: 2,
          });
          for (const m of i.milestones) planner.saveTodo({ title: m, listId, parentId: goal.id });
          return ok(
            `Goal set: ${goal.title}${i.target ? `, target ${human(i.target)}` : ' (no target date: progress can only be judged with one)'}, ${i.milestones.length} milestones. It is in Tasks → ${GOALS_LIST}.`,
          );
        }
        const listId = goalsListId(false);
        if (!listId) return ok('No goals yet.');
        const all = planner.todos();
        const goals = all.filter((t) => t.listId === listId && !t.parentId);
        if (!goals.length) return ok('No goals yet.');
        const at = now();
        const lines = goals
          .map((g) => ({
            g,
            p: goalProgress(
              g,
              all.filter((t) => t.parentId === g.id),
              at,
            ),
          }))
          .sort((a, b) => order(a.p.status) - order(b.p.status))
          .map(({ g, p }) => goalLine(g, p));
        return ok(lines.join('\n'));
      },
    }),
  ];
}

const ORDER: GoalStatus[] = ['overdue', 'behind', 'on track', 'no target date', 'done'];
const order = (s: GoalStatus): number => ORDER.indexOf(s);
