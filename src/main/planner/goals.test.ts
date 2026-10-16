import { describe, expect, it } from 'vitest';
import type { Todo } from '@shared/planner';
import { goalProgress } from './goals';

const todo = (over: Partial<Todo>): Todo => ({
  id: 'td_1',
  listId: null,
  parentId: null,
  title: 'Run a half marathon',
  notes: '',
  status: 'todo',
  priority: 2,
  dueDate: '2026-12-31',
  dueTime: null,
  durationMin: null,
  remindAt: null,
  recurrence: null,
  tags: [],
  starred: false,
  sortOrder: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  completedAt: null,
  ...over,
});
const steps = (done: number, total: number): Todo[] =>
  Array.from({ length: total }, (_, i) =>
    todo({ id: `td_m${i}`, status: i < done ? 'done' : 'todo' }),
  );

describe('goal progress (ruflo goals idea: drift against the calendar)', () => {
  const mid = new Date('2026-11-16T00:00:00'); // about half the time gone

  it('is on track when milestones keep up with the time that has passed', () => {
    expect(goalProgress(todo({}), steps(2, 4), mid).status).toBe('on track');
  });

  it('is behind when milestones trail the calendar by more than the slack', () => {
    const p = goalProgress(todo({}), steps(0, 4), mid);
    expect(p.status).toBe('behind');
    expect(p.elapsed).toBeGreaterThan(0.4);
  });

  it('is overdue after the target day, done when the goal is ticked, and unmeasured without a date or milestones', () => {
    expect(goalProgress(todo({}), steps(4, 4), new Date('2027-01-01T08:00:00')).status).toBe(
      'overdue',
    );
    expect(goalProgress(todo({}), steps(4, 4), new Date('2026-12-31T23:00:00')).status).toBe(
      'on track',
    );
    expect(goalProgress(todo({ status: 'done' }), [], mid).status).toBe('done');
    expect(goalProgress(todo({ dueDate: null }), steps(0, 3), mid).status).toBe('no target date');
    expect(goalProgress(todo({}), [], mid).status).toBe('on track');
  });
});
