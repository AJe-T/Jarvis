import { useMemo, useState } from 'react';
import { AlertTriangle, Archive, CalendarClock, GripVertical, Plus, Search } from 'lucide-react';
import clsx from 'clsx';
import { PLANNER_COLORS, type Todo, type TodoList } from '@shared/planner';
import { call } from '../../lib/api';
import { plannerCall } from '../../stores/planner-store';
import { between, dueLabel, listSummary, type ListSummary } from './task-filters';

const STATUS_DOT = { todo: 'bg-ink-500', doing: 'bg-lamp-400', done: 'bg-ok-400' } as const;
export const LIST_ICONS = [
  '📋',
  '💼',
  '🏠',
  '🛒',
  '📚',
  '💪',
  '✈️',
  '💡',
  '🎯',
  '🧾',
  '🎨',
  '🧪',
  '💻',
  '❤️',
  '🌱',
  '🎉',
];

function ProgressRing({ pct, color }: { pct: number; color: string }): React.JSX.Element {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" className="size-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        className="transition-[stroke-dasharray] duration-500"
      />
    </svg>
  );
}

function ListCard({
  list,
  s,
  today,
  dragging,
  onOpen,
  onDragStart,
  onDrop,
}: {
  list: TodoList;
  s: ListSummary;
  today: string;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}): React.JSX.Element {
  const next = s.next ? dueLabel(s.next, today) : null;
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={clsx('group relative', dragging && 'opacity-40')}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${list.name}: ${s.counts.todo} to do, ${s.counts.doing} doing, ${s.counts.done} done`}
        className={clsx(
          'card flex h-full w-full flex-col gap-3 overflow-hidden border-l-4 p-4 text-left transition-[transform,box-shadow,border-color] duration-[180ms]',
          'hover:-translate-y-0.5 hover:border-accent-edge hover:shadow-pop focus-visible:shadow-pop',
          list.archived && 'opacity-70',
        )}
        style={{ borderLeftColor: list.color }}
      >
        <div className="flex items-start gap-3">
          <div className="relative">
            <ProgressRing pct={s.pct} color={list.color} />
            <span className="absolute inset-0 grid place-items-center text-lg">
              {list.icon || <span className="text-2xs font-semibold text-ink-300">{s.pct}%</span>}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-ink-100">{list.name}</h3>
            <p className="text-xs text-ink-500">
              {s.total === 0 ? 'No tasks yet' : `${s.counts.done} of ${s.total} done · ${s.pct}%`}
              {list.archived && ' · archived'}
            </p>
          </div>
          <GripVertical
            size={16}
            aria-hidden
            className="shrink-0 cursor-grab text-ink-500 opacity-0 transition-opacity group-hover:opacity-100"
          />
        </div>

        {list.description && (
          <p className="line-clamp-2 text-sm text-ink-300">{list.description}</p>
        )}

        <div className="grid grid-cols-3 gap-1.5">
          {(['todo', 'doing', 'done'] as const).map((k) => (
            <span
              key={k}
              className={clsx(
                'flex flex-col rounded-sm border px-2 py-1.5',
                k === 'doing' && s.overLimit
                  ? 'border-alarm-500 bg-alarm-tint'
                  : 'border-line-subtle bg-surface-2',
              )}
            >
              <span className="flex items-center gap-1.5 text-2xs text-ink-500 uppercase">
                <span className={clsx('size-1.5 rounded-pill', STATUS_DOT[k])} />
                {k === 'todo' ? 'To do' : k === 'doing' ? 'Doing' : 'Done'}
              </span>
              <span className="text-xl font-semibold text-ink-100 tabular-nums">
                {s.counts[k]}
                {k === 'doing' && list.wipLimit !== null && (
                  <span className="text-xs font-normal text-ink-500">/{list.wipLimit}</span>
                )}
              </span>
            </span>
          ))}
        </div>

        {s.preview.length > 0 && (
          <ul className="flex flex-col gap-1">
            {s.preview.map((t: Todo) => (
              <li key={t.id} className="flex items-center gap-2 text-sm text-ink-300">
                <span className={clsx('size-1.5 shrink-0 rounded-pill', STATUS_DOT[t.status])} />
                <span className="truncate">{t.title}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-subtle pt-2 text-xs">
          {s.overdue > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-alarm-500">
              <AlertTriangle size={12} aria-hidden /> {s.overdue} overdue
            </span>
          )}
          {s.next && next ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-ink-500">
              <CalendarClock size={12} aria-hidden className="shrink-0" />
              <span className="truncate">
                Next: {s.next.title} · {next.text}
              </span>
            </span>
          ) : (
            <span className="text-ink-500">
              {s.counts.todo + s.counts.doing ? 'Nothing due' : 'All clear'}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function NewListCard({
  count,
  onCreated,
}: {
  count: number;
  onCreated: (l: TodoList) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState<string>(
    PLANNER_COLORS[count % PLANNER_COLORS.length] ?? '#22d3ee',
  );
  if (!open)
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-line text-ink-500 transition-colors hover:border-accent-edge hover:bg-hover hover:text-accent-300"
        >
          <Plus size={22} aria-hidden />
          <span className="text-sm font-medium">New list</span>
          <span className="text-xs">Work, Home, a project…</span>
        </button>
      </li>
    );
  return (
    <li>
      <form
        className="card flex h-full min-h-48 flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void plannerCall(call('todos:saveList', { name: name.trim(), icon, color })).then((l) => {
            if (l) onCreated(l);
          });
          setOpen(false);
          setName('');
          setIcon('');
        }}
      >
        <input
          autoFocus
          aria-label="List name"
          placeholder="List name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          className="h-9 rounded-sm border border-accent-edge bg-surface-2 px-2.5 text-ink-100 outline-none"
        />
        <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1">
          {LIST_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={icon === i}
              aria-label={`Icon ${i}`}
              onClick={() => setIcon(icon === i ? '' : i)}
              className={clsx(
                'size-7 rounded-sm text-base hover:bg-hover',
                icon === i && 'bg-selected ring-1 ring-accent-edge',
              )}
            >
              {i}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
          {PLANNER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              className={clsx(
                'size-5 rounded-pill',
                color === c && 'ring-2 ring-ink-100 ring-offset-2 ring-offset-surface-1',
              )}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mt-auto flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-sm px-3 py-1.5 text-sm text-ink-300 hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-sm bg-accent-600 px-3 py-1.5 text-sm font-semibold text-ink-on-accent disabled:opacity-40"
          >
            Create list
          </button>
        </div>
      </form>
    </li>
  );
}

/** Tasks → Lists: every list as a card (progress, To do / Doing / Done, what's next); drag to reorder. */
export function ListsHome({
  lists,
  todos,
  today,
  onOpen,
}: {
  lists: TodoList[];
  todos: Todo[];
  today: string;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const archivedCount = lists.filter((l) => l.archived).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lists.filter(
      (l) =>
        (showArchived || !l.archived) &&
        (!q || l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)),
    );
  }, [lists, query, showArchived]);
  const summaries = useMemo(
    () => new Map(lists.map((l) => [l.id, listSummary(l, todos, today)])),
    [lists, todos, today],
  );
  const totals = useMemo(() => {
    let open = 0;
    let doing = 0;
    let overdue = 0;
    for (const l of lists.filter((x) => !x.archived)) {
      const s = summaries.get(l.id);
      open += (s?.counts.todo ?? 0) + (s?.counts.doing ?? 0);
      doing += s?.counts.doing ?? 0;
      overdue += s?.overdue ?? 0;
    }
    return { open, doing, overdue };
  }, [lists, summaries]);

  function dropOn(targetId: string): void {
    if (!dragId || dragId === targetId) return setDragId(null);
    const ids = lists.map((l) => l.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetId);
    const before = lists.find((l) => l.id === ids[at - 1])?.sortOrder;
    const after = lists.find((l) => l.id === targetId)?.sortOrder;
    void plannerCall(call('todos:saveList', { id: dragId, sortOrder: between(before, after) }));
    setDragId(null);
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="text-sm text-ink-300">
          <b className="text-ink-100">{lists.length - archivedCount}</b> lists ·{' '}
          <b className="text-ink-100">{totals.open}</b> open ·{' '}
          <b className="text-lamp-400">{totals.doing}</b> in progress
          {totals.overdue > 0 && (
            <>
              {' '}
              · <b className="text-alarm-500">{totals.overdue}</b> overdue
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-sm border border-line px-2 focus-within:border-accent-edge">
            <Search size={14} aria-hidden className="text-ink-500" />
            <input
              aria-label="Search lists"
              placeholder="Find a list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-36 bg-transparent text-sm text-ink-100 outline-none placeholder:text-ink-500"
            />
          </div>
          {archivedCount > 0 && (
            <button
              type="button"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className={clsx(
                'inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-sm',
                showArchived
                  ? 'border-accent-edge bg-selected text-accent-300'
                  : 'border-line text-ink-300 hover:bg-hover',
              )}
            >
              <Archive size={14} aria-hidden /> Archived ({archivedCount})
            </button>
          )}
        </div>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4">
        {shown.map((l) => {
          const s = summaries.get(l.id);
          return s ? (
            <ListCard
              key={l.id}
              list={l}
              s={s}
              today={today}
              dragging={dragId === l.id}
              onOpen={() => onOpen(l.id)}
              onDragStart={() => setDragId(l.id)}
              onDrop={() => dropOn(l.id)}
            />
          ) : null;
        })}
        {!query && <NewListCard count={lists.length} onCreated={(l) => onOpen(l.id)} />}
      </ul>
      {query && shown.length === 0 && (
        <p className="text-sm text-ink-500">No list matches “{query}”.</p>
      )}
    </div>
  );
}
