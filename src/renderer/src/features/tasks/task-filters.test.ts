import { describe, expect, it } from 'vitest';
import type { Todo, TodoList } from '@shared/planner';
import {
  NO_FILTER,
  between,
  groupTodos,
  inScope,
  isRecentDone,
  listSummary,
  matchesFilter,
  quadrant,
  sortTodos,
  taskStats,
} from './task-filters';

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

describe('lists', () => {
  const list: TodoList = {
    id: 'tl_work1',
    name: 'Work',
    color: '#22d3ee',
    icon: '',
    sortOrder: 0,
    description: '',
    wipLimit: 1,
    archived: false,
  };
  const L = { listId: 'tl_work1' };

  it('summarises a list: counts, progress, overdue, next due, Doing limit', () => {
    const tasks = [
      todo({ ...L, title: 'a', status: 'doing' }),
      todo({ ...L, title: 'b', status: 'doing' }),
      todo({ ...L, title: 'c', dueDate: '2026-10-08' }),
      todo({ ...L, title: 'd', dueDate: '2026-10-12' }),
      todo({ ...L, title: 'e', status: 'done' }),
      todo({ title: 'other list' }),
      todo({ ...L, title: 'sub', parentId: 'td_x0000' }),
    ];
    const s = listSummary(list, tasks, TODAY);
    expect(s.counts).toEqual({ todo: 2, doing: 2, done: 1 });
    expect(s.total).toBe(5);
    expect(s.pct).toBe(20);
    expect(s.overdue).toBe(1);
    expect(s.next?.title).toBe('c');
    expect(s.preview.map((t) => t.title)).toEqual(['a', 'b', 'c']);
    expect(s.overLimit).toBe(true);
    expect(listSummary({ ...list, wipLimit: null }, tasks, TODAY).overLimit).toBe(false);
  });

  it('the Lists home shows no tasks of its own', () => {
    expect(inScope(todo({ ...L }), { kind: 'lists' }, TODAY)).toBe(false);
  });

  it('filters a board by priority, due date and tag', () => {
    const urgent = todo({ priority: 1, tags: ['client'], dueDate: '2026-10-08' });
    const later = todo({ priority: 3, dueDate: '2026-10-20' });
    const undated = todo({});
    const f = (p: Partial<typeof NO_FILTER>) => ({ ...NO_FILTER, ...p });
    expect(matchesFilter(urgent, f({ priority: 1 }), TODAY)).toBe(true);
    expect(matchesFilter(later, f({ priority: 1 }), TODAY)).toBe(false);
    expect(matchesFilter(urgent, f({ due: 'overdue' }), TODAY)).toBe(true);
    expect(matchesFilter(later, f({ due: 'week' }), TODAY)).toBe(false);
    expect(matchesFilter(undated, f({ due: 'none' }), TODAY)).toBe(true);
    expect(matchesFilter(urgent, f({ tag: 'client' }), TODAY)).toBe(true);
    expect(matchesFilter(later, f({ tag: 'client' }), TODAY)).toBe(false);
  });

  it('folds tasks finished over a week ago', () => {
    expect(isRecentDone(todo({ status: 'done', completedAt: '2026-10-08T10:00:00' }), TODAY)).toBe(
      true,
    );
    expect(isRecentDone(todo({ status: 'done', completedAt: '2026-09-20T10:00:00' }), TODAY)).toBe(
      false,
    );
    expect(isRecentDone(todo({}), TODAY)).toBe(true);
  });
});
