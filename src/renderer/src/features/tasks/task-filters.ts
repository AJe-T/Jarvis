import type { Todo, TodoList, TodoStatus } from '@shared/planner';
import { addDays, parseLocal, startOfWeek, toDateKey } from '@shared/planner-time';

/** Pure helpers for the Tasks view: which tasks a sidebar entry shows, order, groups, labels, stats. */

export type SmartId = 'inbox' | 'today' | 'upcoming' | 'starred' | 'all' | 'done';
export type Scope =
  | { kind: 'lists' }
  | { kind: 'smart'; id: SmartId }
  | { kind: 'list'; id: string }
  | { kind: 'tag'; tag: string };
export type SortKey = 'smart' | 'due' | 'priority' | 'title' | 'created' | 'manual';

export const SMART: Array<{ id: SmartId; label: string }> = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'starred', label: 'Starred' },
  { id: 'all', label: 'All tasks' },
  { id: 'done', label: 'Completed' },
];

export function inScope(t: Todo, scope: Scope, today: string): boolean {
  if (t.parentId || scope.kind === 'lists') return false;
  const open = t.status !== 'done';
  if (scope.kind === 'list') return t.listId === scope.id;
  if (scope.kind === 'tag') return open && t.tags.includes(scope.tag);
  switch (scope.id) {
    case 'inbox':
      return open && !t.listId;
    case 'today':
      return open && !!t.dueDate && t.dueDate <= today;
    case 'upcoming':
      return open && !!t.dueDate && t.dueDate > today;
    case 'starred':
      return open && t.starred;
    case 'done':
      return !open;
    default:
      return open;
  }
}

const due = (t: Todo): string => (t.dueDate ? `${t.dueDate}T${t.dueTime ?? '99:99'}` : '~');

export function sortTodos(list: Todo[], key: SortKey): Todo[] {
  const byManual = (a: Todo, b: Todo): number => a.sortOrder - b.sortOrder;
  const cmp: Record<SortKey, (a: Todo, b: Todo) => number> = {
    // Smart: what to do next first — doing, then due, then priority, then Sir's own order.
    smart: (a, b) =>
      Number(b.status === 'doing') - Number(a.status === 'doing') ||
      due(a).localeCompare(due(b)) ||
      a.priority - b.priority ||
      byManual(a, b),
    due: (a, b) => due(a).localeCompare(due(b)) || a.priority - b.priority,
    priority: (a, b) => a.priority - b.priority || due(a).localeCompare(due(b)),
    title: (a, b) => a.title.localeCompare(b.title),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    manual: byManual,
  };
  return [...list].sort(cmp[key]);
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  const d = parseLocal(date);
  const near = date > today && date < addDays(today, 7);
  return d.toLocaleDateString(
    'en-GB',
    near
      ? { weekday: 'long' }
      : {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}),
        },
  );
}

export interface Group {
  key: string;
  label: string;
  items: Todo[];
}

export function groupTodos(list: Todo[], scope: Scope, today: string): Group[] {
  const groups = new Map<string, Group>();
  const put = (key: string, label: string, t: Todo): void => {
    const g = groups.get(key) ?? { key, label, items: [] };
    g.items.push(t);
    groups.set(key, g);
  };
  for (const t of list) {
    if (scope.kind === 'smart' && scope.id === 'today')
      put(
        t.dueDate && t.dueDate < today ? 'a' : 'b',
        t.dueDate && t.dueDate < today ? 'Overdue' : 'Today',
        t,
      );
    else if (scope.kind === 'smart' && scope.id === 'upcoming')
      put(t.dueDate ?? '', dayLabel(t.dueDate ?? today, today), t);
    else if (scope.kind === 'smart' && scope.id === 'done') {
      const day = t.completedAt ? toDateKey(new Date(t.completedAt)) : today;
      put(`~${day}`, dayLabel(day, today), t);
    } else if (scope.kind === 'list')
      put(t.status === 'done' ? 'z' : 'a', t.status === 'done' ? 'Completed' : '', t);
    else put('a', '', t);
  }
  const out = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  // Completed: newest day first.
  return scope.kind === 'smart' && scope.id === 'done' ? out.reverse() : out;
}

export type Tone = 'overdue' | 'today' | 'soon' | 'later';

export function dueLabel(t: Todo, today: string): { text: string; tone: Tone } | null {
  if (!t.dueDate) return null;
  const tone: Tone =
    t.dueDate < today
      ? 'overdue'
      : t.dueDate === today
        ? 'today'
        : t.dueDate <= addDays(today, 2)
          ? 'soon'
          : 'later';
  return { text: `${dayLabel(t.dueDate, today)}${t.dueTime ? ` ${t.dueTime}` : ''}`, tone };
}

export interface TaskStats {
  doneToday: number;
  doneWeek: number;
  /** Days in a row (ending today or yesterday) with at least one task done. */
  streak: number;
  overdue: number;
}

export function taskStats(todos: Todo[], today: string): TaskStats {
  const days = new Set<string>();
  let doneToday = 0;
  let doneWeek = 0;
  let overdue = 0;
  const week = startOfWeek(today);
  for (const t of todos) {
    if (t.status === 'done' && t.completedAt) {
      const d = toDateKey(new Date(t.completedAt));
      days.add(d);
      if (d === today) doneToday++;
      if (d >= week) doneWeek++;
    } else if (!t.parentId && t.dueDate && t.dueDate < today) overdue++;
  }
  let streak = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) {
    streak++;
    d = addDays(d, -1);
  }
  return { doneToday, doneWeek, streak, overdue };
}

/** Eisenhower matrix: 0 do now · 1 schedule · 2 quick wins · 3 later. */
export function quadrant(t: Todo, today: string): 0 | 1 | 2 | 3 {
  const important = t.priority <= 2 || t.starred;
  const urgent = !!t.dueDate && t.dueDate <= addDays(today, 1);
  return important ? (urgent ? 0 : 1) : urgent ? 2 : 3;
}

/** sortOrder for a task dropped between two neighbours (manual order). */
export function between(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return Date.now();
  if (before === undefined) return (after ?? 0) - 1024;
  if (after === undefined) return before + 1024;
  return (before + after) / 2;
}

// ── Lists (the Lists home and a list's board) ──────────────────────────────────────────────

export interface ListSummary {
  counts: Record<TodoStatus, number>;
  total: number;
  /** Share done, 0–100. */
  pct: number;
  overdue: number;
  /** The open task due soonest. */
  next: Todo | null;
  /** First open tasks in "what to do next" order, for the card preview. */
  preview: Todo[];
  /** Over the list's "Doing" limit. */
  overLimit: boolean;
}

/** Everything a list card shows, from the list's top-level tasks. */
export function listSummary(list: TodoList, todos: Todo[], today: string): ListSummary {
  const mine = todos.filter((t) => t.listId === list.id && !t.parentId);
  const counts: Record<TodoStatus, number> = { todo: 0, doing: 0, done: 0 };
  for (const t of mine) counts[t.status]++;
  const open = sortTodos(
    mine.filter((t) => t.status !== 'done'),
    'smart',
  );
  const dated = open.filter((t) => t.dueDate).sort((a, b) => due(a).localeCompare(due(b)));
  return {
    counts,
    total: mine.length,
    pct: mine.length ? Math.round((counts.done / mine.length) * 100) : 0,
    overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
    next: dated[0] ?? null,
    preview: open.slice(0, 3),
    overLimit: list.wipLimit !== null && counts.doing > list.wipLimit,
  };
}

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';

export interface BoardFilter {
  /** 0 = any priority, else only this one. */
  priority: number;
  due: DueFilter;
  tag: string | null;
}

export const NO_FILTER: BoardFilter = { priority: 0, due: 'all', tag: null };

export function isFiltered(f: BoardFilter): boolean {
  return f.priority !== 0 || f.due !== 'all' || f.tag !== null;
}

/** A list's filter bar: priority, when it's due, and one tag. Done tasks only match "all" dates. */
export function matchesFilter(t: Todo, f: BoardFilter, today: string): boolean {
  if (f.priority && t.priority !== f.priority) return false;
  if (f.tag && !t.tags.includes(f.tag)) return false;
  switch (f.due) {
    case 'overdue':
      return !!t.dueDate && t.dueDate < today && t.status !== 'done';
    case 'today':
      return t.dueDate === today;
    case 'week':
      return !!t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 7);
    case 'none':
      return !t.dueDate;
    default:
      return true;
  }
}

/** Done tasks finished before this many days ago fold away under "Show older" on the board. */
export const RECENT_DONE_DAYS = 7;

export function isRecentDone(t: Todo, today: string): boolean {
  if (t.status !== 'done' || !t.completedAt) return true;
  return toDateKey(new Date(t.completedAt)) >= addDays(today, -RECENT_DONE_DAYS);
}
