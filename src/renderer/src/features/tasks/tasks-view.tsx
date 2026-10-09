import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCheck,
  Flame,
  Grid2x2,
  Hash,
  Inbox,
  Kanban,
  List,
  ListChecks,
  Plus,
  Search,
  Star,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { PLANNER_COLORS, type TodoList } from '@shared/planner';
import { toDateKey } from '@shared/planner-time';
import type { QuickAdd } from '@shared/quick-add';
import { IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { PageHeader } from '../../components/ui/page';
import { call } from '../../lib/api';
import { plannerCall, usePlannerStore } from '../../stores/planner-store';
import { QuickAddInput, selectClass } from './planner-kit';
import { TaskBoard, TaskMatrix } from './task-boards';
import { TaskDetail } from './task-detail';
import {
  SMART,
  between,
  groupTodos,
  inScope,
  sortTodos,
  taskStats,
  type Scope,
  type SmartId,
  type SortKey,
} from './task-filters';
import { TaskRow } from './task-row';

type Mode = 'list' | 'board' | 'matrix';
const PREFS_KEY = 'jarvis.tasks.view';
const SMART_ICON: Record<SmartId, LucideIcon> = {
  inbox: Inbox,
  today: Sun,
  upcoming: CalendarDays,
  starred: Star,
  all: ListChecks,
  done: CheckCheck,
};

function loadPrefs(): { scope: Scope; mode: Mode; sort: SortKey } {
  const fallback = {
    scope: { kind: 'smart', id: 'today' } as Scope,
    mode: 'list' as Mode,
    sort: 'smart' as SortKey,
  };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as typeof fallback | null;
    return v && typeof v === 'object' && v.scope && v.mode && v.sort ? v : fallback;
  } catch {
    return fallback;
  }
}

function ListRow({
  list,
  count,
  active,
  onOpen,
}: {
  list: TodoList;
  count: number;
  active: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const next =
    PLANNER_COLORS[
      (PLANNER_COLORS.indexOf(list.color as (typeof PLANNER_COLORS)[number]) + 1) %
        PLANNER_COLORS.length
    ];
  return (
    <li
      className={clsx(
        'group flex h-8 items-center gap-2 rounded-sm px-2 text-sm',
        active ? 'rail-active' : 'text-ink-300 hover:bg-hover hover:text-ink-100',
      )}
    >
      <button
        type="button"
        aria-label={`Change colour of ${list.name}`}
        title="Change colour"
        onClick={() =>
          void plannerCall(call('todos:saveList', { id: list.id, name: list.name, color: next }))
        }
        className="size-2.5 shrink-0 rounded-pill"
        style={{ background: list.color }}
      />
      {editing ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim())
              void plannerCall(call('todos:saveList', { id: list.id, name: name.trim() }));
            setEditing(false);
          }}
        >
          <input
            autoFocus
            aria-label="List name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setEditing(false)}
            className="w-full bg-transparent text-ink-100 outline-none focus-visible:outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          onClick={onOpen}
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >
          {`${list.icon} ${list.name}`.trim()}
        </button>
      )}
      <span className="text-xs text-ink-500 group-hover:hidden">{count || ''}</span>
      <button
        type="button"
        aria-label={`Delete list ${list.name}`}
        className="hidden text-ink-500 group-hover:block hover:text-alarm-500"
        onClick={() =>
          void confirmAction({
            title: `Delete "${list.name}"?`,
            body: 'Its tasks move to the Inbox.',
            actionLabel: 'Delete list',
            destructive: true,
          }).then((ok) => void (ok && plannerCall(call('todos:deleteList', { id: list.id }))))
        }
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </li>
  );
}

/** PRD F25: Tasks — smart lists, projects, list / board / matrix, natural-language quick add. */
export function TasksView(): React.JSX.Element {
  const { lists, todos, loaded, refresh } = usePlannerStore();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newList, setNewList] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const quickRef = useRef<HTMLInputElement>(null);
  const today = toDateKey(new Date());
  const { scope, mode, sort } = prefs;

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  // Opened from the Calendar: show that task.
  const focusTodo = usePlannerStore((s) => s.focusTodo);
  useEffect(() => {
    if (!focusTodo) return;
    setSelectedId(focusTodo);
    setPrefs((p) => ({ ...p, scope: { kind: 'smart', id: 'all' } }));
    usePlannerStore.getState().setFocusTodo(null);
  }, [focusTodo]);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // not remembered; fine
    }
  }, [prefs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing =
        e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'n' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        quickRef.current?.focus();
      }
      if (e.key === 'Escape' && !typing) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const listMap = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const subsOf = useMemo(() => {
    const m = new Map<string, typeof todos>();
    for (const t of todos) if (t.parentId) m.set(t.parentId, [...(m.get(t.parentId) ?? []), t]);
    return m;
  }, [todos]);
  const tags = useMemo(
    () => [...new Set(todos.filter((t) => t.status !== 'done').flatMap((t) => t.tags))].sort(),
    [todos],
  );
  const count = (s: Scope): number =>
    todos.filter((t) => inScope(t, s, today) && t.status !== 'done').length;
  const stats = useMemo(() => taskStats(todos, today), [todos, today]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inView = todos.filter(
      (t) =>
        inScope(t, scope, today) &&
        (!q ||
          t.title.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          t.tags.some((x) => x.includes(q))),
    );
    return sortTodos(inView, sort);
  }, [todos, scope, today, query, sort]);
  const groups = useMemo(() => groupTodos(visible, scope, today), [visible, scope, today]);
  const selected = todos.find((t) => t.id === selectedId) ?? null;

  const title =
    scope.kind === 'smart'
      ? (SMART.find((s) => s.id === scope.id)?.label ?? 'Tasks')
      : scope.kind === 'list'
        ? (listMap.get(scope.id)?.name ?? 'List')
        : `#${scope.tag}`;
  const setScope = (s: Scope): void => setPrefs((p) => ({ ...p, scope: s }));
  const same = (a: Scope, b: Scope): boolean => JSON.stringify(a) === JSON.stringify(b);

  function add(_text: string, q: QuickAdd): void {
    const hashList = q.hashtags
      .map((h) => lists.find((l) => l.name.toLowerCase() === h.toLowerCase()))
      .find(Boolean);
    const scopeList = scope.kind === 'list' ? scope.id : null;
    void plannerCall(
      call('todos:save', {
        title: q.title,
        listId: hashList?.id ?? scopeList,
        dueDate: q.date ?? (scope.kind === 'smart' && scope.id === 'today' ? today : null),
        dueTime: q.time,
        durationMin: q.durationMin,
        priority: q.priority ?? 4,
        recurrence: q.recurrence,
        tags: [
          ...new Set([
            ...q.hashtags.filter((h) => h.toLowerCase() !== hashList?.name.toLowerCase()),
            ...(scope.kind === 'tag' ? [scope.tag] : []),
          ]),
        ],
        starred: scope.kind === 'smart' && scope.id === 'starred',
      }),
    ).then((t) => t && setSelectedId(null));
  }

  function dropOn(targetId: string): void {
    if (!dragId || dragId === targetId) return;
    const ids = visible.map((t) => t.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetId);
    const before = visible.find((t) => t.id === ids[at - 1])?.sortOrder;
    const after = visible.find((t) => t.id === targetId)?.sortOrder;
    void plannerCall(call('todos:save', { id: dragId, sortOrder: between(before, after) }));
    setDragId(null);
  }

  return (
    <div className="flex min-w-0 flex-1">
      <nav
        aria-label="Task lists"
        className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line-subtle p-3 md:flex"
      >
        <ul className="flex flex-col gap-0.5">
          {SMART.map((s) => {
            const Icon = SMART_ICON[s.id];
            const sc: Scope = { kind: 'smart', id: s.id };
            const n = s.id === 'done' ? 0 : count(sc);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={same(scope, sc) ? 'page' : undefined}
                  onClick={() => setScope(sc)}
                  className={clsx(
                    'flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-sm',
                    same(scope, sc)
                      ? 'rail-active'
                      : 'text-ink-300 hover:bg-hover hover:text-ink-100',
                  )}
                >
                  <Icon
                    size={15}
                    aria-hidden
                    className={s.id === 'today' && stats.overdue ? 'text-alarm-500' : ''}
                  />
                  {s.label}
                  {n > 0 && <span className="ml-auto text-xs text-ink-500">{n}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div>
          <div className="mb-1 flex items-center px-2">
            <h2 className="font-code text-[11px] font-semibold tracking-widest text-ink-500 uppercase">
              Lists
            </h2>
            <IconButton label="New list" className="ml-auto size-6" onClick={() => setNewList('')}>
              <Plus size={14} aria-hidden />
            </IconButton>
          </div>
          <ul className="flex flex-col gap-0.5">
            {lists.map((l) => (
              <ListRow
                key={l.id}
                list={l}
                count={count({ kind: 'list', id: l.id })}
                active={same(scope, { kind: 'list', id: l.id })}
                onOpen={() => setScope({ kind: 'list', id: l.id })}
              />
            ))}
          </ul>
          {newList !== null && (
            <form
              className="mt-1 px-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newList.trim())
                  void plannerCall(call('todos:saveList', { name: newList.trim() })).then(
                    (l) => l && setScope({ kind: 'list', id: l.id }),
                  );
                setNewList(null);
              }}
            >
              <input
                autoFocus
                aria-label="New list name"
                placeholder="List name, Enter"
                value={newList}
                onChange={(e) => setNewList(e.target.value)}
                onBlur={() => setNewList(null)}
                className="h-8 w-full rounded-sm border border-accent-edge bg-surface-1 px-2 text-sm text-ink-100 outline-none focus-visible:outline-none"
              />
            </form>
          )}
          {lists.length === 0 && newList === null && (
            <p className="px-2 text-xs text-ink-500">Group tasks into lists like Work or Home.</p>
          )}
        </div>
        {tags.length > 0 && (
          <div>
            <h2 className="mb-1 px-2 font-code text-[11px] font-semibold tracking-widest text-ink-500 uppercase">
              Tags
            </h2>
            <ul className="flex flex-col gap-0.5">
              {tags.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => setScope({ kind: 'tag', tag: t })}
                    className={clsx(
                      'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm',
                      same(scope, { kind: 'tag', tag: t })
                        ? 'rail-active'
                        : 'text-ink-300 hover:bg-hover',
                    )}
                  >
                    <Hash size={13} aria-hidden /> {t}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title={title}>
          <div className="hidden items-center gap-1 rounded-sm border border-line px-2 focus-within:border-accent-edge lg:flex">
            <Search size={13} aria-hidden className="text-ink-500" />
            <input
              aria-label="Search tasks"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-32 bg-transparent text-sm text-ink-100 outline-none focus-visible:outline-none placeholder:text-ink-500"
            />
          </div>
          <select
            aria-label="Sort"
            className={selectClass}
            value={sort}
            onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as SortKey }))}
          >
            <option value="smart">Smart order</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="title">A–Z</option>
            <option value="created">Newest</option>
            <option value="manual">My order (drag)</option>
          </select>
          <div
            className="flex rounded-sm border border-line p-0.5"
            role="radiogroup"
            aria-label="Layout"
          >
            {(
              [
                ['list', List, 'List'],
                ['board', Kanban, 'Board'],
                ['matrix', Grid2x2, 'Priority matrix'],
              ] as const
            ).map(([m, Icon, label]) => (
              <IconButton
                key={m}
                label={label}
                active={mode === m}
                className="size-7"
                onClick={() => setPrefs((p) => ({ ...p, mode: m }))}
              >
                <Icon size={14} aria-hidden />
              </IconButton>
            ))}
          </div>
          {scope.kind === 'smart' && scope.id === 'done' && visible.length > 0 && (
            <IconButton
              label="Clear completed"
              onClick={() =>
                void confirmAction({
                  title: 'Clear completed tasks?',
                  body: `${visible.length} completed tasks will be deleted.`,
                  actionLabel: 'Clear',
                  destructive: true,
                }).then((ok) => void (ok && plannerCall(call('todos:clearCompleted', {}))))
              }
            >
              <Trash2 size={15} aria-hidden />
            </IconButton>
          )}
        </PageHeader>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line-subtle px-4 py-2 text-xs text-ink-500 md:px-6">
          <span>
            <b className="text-ink-100">{stats.doneToday}</b> done today
          </span>
          <span>
            <b className="text-ink-100">{stats.doneWeek}</b> this week
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame size={12} aria-hidden className={stats.streak ? 'text-lamp-400' : ''} />
            <b className="text-ink-100">{stats.streak}</b> day streak
          </span>
          {stats.overdue > 0 && (
            <button
              type="button"
              onClick={() => setScope({ kind: 'smart', id: 'today' })}
              className="text-alarm-500 hover:underline"
            >
              {stats.overdue} overdue
            </button>
          )}
          <span className="ml-auto hidden xl:inline">
            Press <kbd className="font-code">N</kbd> to add · try “call mom tomorrow 6pm #home !1
            every week”
          </span>
        </div>

        <div className="px-4 pt-3 md:px-6">
          <QuickAddInput
            inputRef={quickRef}
            today={today}
            placeholder={`Add a task to ${title}`}
            onSubmit={add}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === 'board' ? (
            <TaskBoard
              todos={visible}
              today={today}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : mode === 'matrix' ? (
            <TaskMatrix
              todos={visible}
              today={today}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <div className="px-4 py-3 md:px-6">
              {groups.map((g) => (
                <section key={g.key} className="mb-4">
                  {g.label && (
                    <h2
                      className={clsx(
                        'mb-1 flex items-center gap-2 px-3 font-code text-[11px] font-semibold tracking-widest uppercase',
                        g.label === 'Overdue' ? 'text-alarm-500' : 'text-ink-500',
                      )}
                    >
                      {g.label} <span className="text-ink-500">{g.items.length}</span>
                    </h2>
                  )}
                  <ul className="overflow-hidden rounded-md border border-line-subtle bg-surface-1">
                    {g.items.map((t) => (
                      <TaskRow
                        key={t.id}
                        todo={t}
                        today={today}
                        lists={listMap}
                        subtasks={subsOf.get(t.id) ?? []}
                        selected={t.id === selectedId}
                        showList={scope.kind !== 'list'}
                        draggable={sort === 'manual'}
                        onSelect={() => setSelectedId(t.id === selectedId ? null : t.id)}
                        onDragStart={() => setDragId(t.id)}
                        onDropOn={() => dropOn(t.id)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {visible.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <CheckCheck size={32} aria-hidden className="text-accent-500" />
                  <p className="text-sm text-ink-300">
                    {query
                      ? 'Nothing matches.'
                      : scope.kind === 'smart' && scope.id === 'today'
                        ? 'All clear for today, sir.'
                        : 'No tasks here yet.'}
                  </p>
                  <p className="text-xs text-ink-500">
                    Type above, or ask Jarvis: “add buy milk to my tasks for tomorrow”.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <TaskDetail
          key={selected.id}
          todo={selected}
          lists={lists}
          subtasks={subsOf.get(selected.id) ?? []}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
