import { describe, expect, it } from 'vitest';
import type { Todo } from '@shared/planner';
import { between, groupTodos, inScope, quadrant, sortTodos, taskStats } from './task-filters';

const TODAY = '2026-10-09';
let n = 0;
const todo = (p: Partial<Todo>): Todo => ({
  id: `td_test${n++}`,
  listId: null,
  parentId: null,
  title: 't',
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
  sortOrder: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  completedAt: null,
  ...p,
});

describe('task filters', () => {
  it('puts overdue and today into Today, split into two groups', () => {
    const list = [
      todo({ dueDate: '2026-10-08' }),
      todo({ dueDate: TODAY }),
      todo({ dueDate: '2026-10-10' }),
    ];
    const today = list.filter((t) => inScope(t, { kind: 'smart', id: 'today' }, TODAY));
    expect(today).toHaveLength(2);
    expect(groupTodos(today, { kind: 'smart', id: 'today' }, TODAY).map((g) => g.label)).toEqual([
      'Overdue',
      'Today',
    ]);
    expect(inScope(todo({ parentId: 'td_parent1' }), { kind: 'smart', id: 'all' }, TODAY)).toBe(
      false,
    );
  });

  it('smart order: doing first, then due, then priority', () => {
    const a = todo({ title: 'a', dueDate: '2026-10-12', priority: 1 });
    const b = todo({ title: 'b', dueDate: '2026-10-10', priority: 4 });
    const c = todo({ title: 'c', status: 'doing' });
    expect(sortTodos([a, b, c], 'smart').map((t) => t.title)).toEqual(['c', 'b', 'a']);
  });

  it('counts a streak of days with something done, and overdue work', () => {
    const done = (d: string): Todo =>
      todo({ status: 'done', completedAt: new Date(`${d}T12:00`).toISOString() });
    const s = taskStats(
      [done('2026-10-09'), done('2026-10-08'), done('2026-10-06'), todo({ dueDate: '2026-10-01' })],
      TODAY,
    );
    expect(s).toMatchObject({ doneToday: 1, streak: 2, overdue: 1 });
  });

  it('sorts tasks into the Eisenhower matrix and finds a slot between neighbours', () => {
    expect(quadrant(todo({ priority: 1, dueDate: TODAY }), TODAY)).toBe(0);
    expect(quadrant(todo({ starred: true }), TODAY)).toBe(1);
    expect(quadrant(todo({ dueDate: '2026-10-10' }), TODAY)).toBe(2);
    expect(quadrant(todo({}), TODAY)).toBe(3);
    expect(between(10, 20)).toBe(15);
    expect(between(undefined, 20)).toBeLessThan(20);
  });
});
