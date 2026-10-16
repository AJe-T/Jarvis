import { useState } from 'react';
import { ChevronDown, Flag, ListTree, Maximize2, NotebookText, Plus, Repeat } from 'lucide-react';
import clsx from 'clsx';
import { TODO_STATUSES, type Todo, type TodoStatus } from '@shared/planner';
import type { QuickAdd } from '@shared/quick-add';
import { call } from '../../lib/api';
import { plannerCall } from '../../stores/planner-store';
import { PRIORITY, QuickAddInput } from './planner-kit';
import { between, dueLabel, isRecentDone, quadrant } from './task-filters';
import { CheckCircle } from './task-row';

const DUE_TONE = {
  overdue: 'bg-alarm-tint text-alarm-500',
  today: 'bg-ok-tint text-ok-400',
  soon: 'bg-lamp-tint text-lamp-400',
  later: 'bg-neutral-tint text-ink-300',
} as const;

function Card({
  todo,
  today,
  selected,
  subtasks = [],
  onSelect,
  onDropBefore,
}: {
  todo: Todo;
  today: string;
  selected: boolean;
  subtasks?: Todo[];
  onSelect: () => void;
  /** A card dropped on this one goes just above it. */
  onDropBefore?: (draggedId: string) => void;
}): React.JSX.Element {
  const due = dueLabel(todo, today);
  const [over, setOver] = useState(false);
  const subsDone = subtasks.filter((t) => t.status === 'done').length;
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', todo.id);
      }}
      onDragOver={(e) => {
        if (!onDropBefore) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!onDropBefore) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id && id !== todo.id) onDropBefore(id);
      }}
      onClick={onSelect}
      className={clsx(
        'card flex cursor-grab items-start gap-2.5 p-3 text-sm transition-[box-shadow,background-color,transform] active:cursor-grabbing',
        selected
          ? 'ring-2 ring-accent-edge'
          : 'hover:-translate-y-px hover:bg-surface-2 hover:shadow-pop',
        over && 'shadow-[0_-3px_0_0_var(--accent-500)]',
      )}
    >
      <CheckCircle todo={todo} size={18} />
      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            'line-clamp-3 leading-snug',
            todo.status === 'done' ? 'text-ink-500 line-through' : 'text-ink-100',
          )}
        >
          {todo.title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
          {due && todo.status !== 'done' && (
            <span className={clsx('rounded-xs px-1.5 py-px font-medium', DUE_TONE[due.tone])}>
              {due.text}
            </span>
          )}
          {todo.priority < 4 && (
            <span
              className={clsx(
                'inline-flex items-center gap-0.5',
                PRIORITY[todo.priority]?.className,
              )}
            >
              <Flag size={11} aria-hidden fill="currentColor" />P{todo.priority}
            </span>
          )}
          {subtasks.length > 0 && (
            <span
              className={clsx(
                'inline-flex items-center gap-0.5',
                subsDone === subtasks.length && 'text-ok-400',
              )}
              title="Subtasks done"
            >
              <ListTree size={11} aria-hidden />
              {subsDone}/{subtasks.length}
            </span>
          )}
          {todo.notes.trim() && <NotebookText size={11} aria-label="Has notes" />}
          {todo.recurrence && <Repeat size={11} aria-label="Repeats" />}
          {todo.tags.slice(0, 3).map((t) => (
            <span key={t} className="text-accent-tag-ink">
              #{t}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}

export const COLUMN: Record<TodoStatus, string> = { todo: 'To do', doing: 'Doing', done: 'Done' };
export const COLUMN_DOT: Record<TodoStatus, string> = {
  todo: 'bg-ink-500',
  doing: 'bg-lamp-400',
  done: 'bg-ok-400',
};
const COLUMN_HINT: Record<TodoStatus, string> = {
  todo: 'Add or drop tasks here',
  doing: 'Drag what you are working on here',
  done: 'Finished tasks land here',
};

/**
 * Kanban: drag a card to another column to change its status, or onto a card to put it above it.
 * On a list's page each column has its own quick add, "Doing" shows the list's limit, and Done folds
 * tasks finished over a week ago.
 */
export function TaskBoard({
  todos,
  today,
  selectedId,
  onSelect,
  subsOf,
  wipLimit = null,
  onAdd,
  onFocusColumn,
}: {
  todos: Todo[];
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  subsOf?: Map<string, Todo[]>;
  wipLimit?: number | null;
  onAdd?: (status: TodoStatus, text: string, parsed: QuickAdd) => void;
  /** Open one column on its own (Lists › Work › To do). */
  onFocusColumn?: (status: TodoStatus) => void;
}): React.JSX.Element {
  const [over, setOver] = useState<TodoStatus | null>(null);
  const [adding, setAdding] = useState<TodoStatus | null>(null);
  const [showOld, setShowOld] = useState(false);

  /** Moves a card into `status`, just above `beforeId` (or to the bottom). */
  function move(id: string, status: TodoStatus, beforeId?: string): void {
    const card = todos.find((t) => t.id === id);
    if (!card) return;
    const col = todos.filter((t) => t.status === status && t.id !== id);
    const at = beforeId ? col.findIndex((t) => t.id === beforeId) : col.length;
    const changed = card.status !== status;
    if (!changed && !beforeId) return;
    void plannerCall(
      call('todos:save', {
        id,
        ...(changed ? { status } : {}),
        sortOrder: between(col[at - 1]?.sortOrder, col[at]?.sortOrder),
      }),
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-x-auto p-4 md:grid-cols-3">
      {TODO_STATUSES.map((s) => {
        const all = todos.filter((t) => t.status === s);
        const items = s === 'done' && !showOld ? all.filter((t) => isRecentDone(t, today)) : all;
        const hidden = all.length - items.length;
        const overLimit = s === 'doing' && wipLimit !== null && all.length > wipLimit;
        return (
          <section
            key={s}
            aria-label={COLUMN[s]}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/plain');
              if (id) move(id, s);
            }}
            className={clsx(
              'flex min-h-64 min-w-0 flex-col rounded-lg border bg-surface-2/60 transition-colors md:min-h-0',
              over === s
                ? 'border-accent-edge bg-accent-tint'
                : overLimit
                  ? 'border-alarm-500'
                  : 'border-line',
            )}
          >
            <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
              <span className={clsx('size-2.5 rounded-pill', COLUMN_DOT[s])} />
              <h2 className="text-sm font-semibold text-ink-100">{COLUMN[s]}</h2>
              <span
                className={clsx(
                  'rounded-pill px-2 text-xs font-medium tabular-nums',
                  overLimit ? 'bg-alarm-tint text-alarm-500' : 'bg-neutral-tint text-ink-300',
                )}
                title={
                  overLimit ? `Over the limit of ${wipLimit}: finish something first` : undefined
                }
              >
                {all.length}
                {s === 'doing' && wipLimit !== null && ` / ${wipLimit}`}
              </span>
              <span className="ml-auto flex items-center gap-0.5">
                {onAdd && s !== 'done' && (
                  <button
                    type="button"
                    aria-label={`Add a task to ${COLUMN[s]}`}
                    aria-expanded={adding === s}
                    onClick={() => setAdding(adding === s ? null : s)}
                    className="grid size-7 place-items-center rounded-sm text-icon-rest hover:bg-hover hover:text-ink-100"
                  >
                    <Plus size={15} aria-hidden />
                  </button>
                )}
                {onFocusColumn && (
                  <button
                    type="button"
                    aria-label={`Open ${COLUMN[s]} on its own`}
                    title={`Open ${COLUMN[s]}`}
                    onClick={() => onFocusColumn(s)}
                    className="grid size-7 place-items-center rounded-sm text-icon-rest hover:bg-hover hover:text-ink-100"
                  >
                    <Maximize2 size={13} aria-hidden />
                  </button>
                )}
              </span>
            </header>
            {adding === s && onAdd && (
              <div className="px-2 pt-2">
                <QuickAddInput
                  today={today}
                  placeholder={`Add to ${COLUMN[s]}…`}
                  onSubmit={(text, parsed) => onAdd(s, text, parsed)}
                />
              </div>
            )}
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {items.map((t) => (
                <Card
                  key={t.id}
                  todo={t}
                  today={today}
                  selected={t.id === selectedId}
                  subtasks={subsOf?.get(t.id) ?? []}
                  onSelect={() => onSelect(t.id)}
                  onDropBefore={(id) => move(id, s, t.id)}
                />
              ))}
              {all.length === 0 && (
                <li className="m-1 rounded-md border border-dashed border-line py-8 text-center text-xs text-ink-500">
                  {COLUMN_HINT[s]}
                </li>
              )}
              {hidden > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowOld(true)}
                    className="flex w-full items-center justify-center gap-1 rounded-sm py-1.5 text-xs text-ink-500 hover:bg-hover hover:text-ink-100"
                  >
                    <ChevronDown size={13} aria-hidden /> Show {hidden} finished over a week ago
                  </button>
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const QUADRANTS = [
  { title: 'Do now', hint: 'Urgent & important', tone: 'border-alarm-500/40' },
  { title: 'Schedule', hint: 'Important, not urgent', tone: 'border-accent-edge' },
  { title: 'Quick wins', hint: 'Urgent, less important', tone: 'border-lamp-400/40' },
  { title: 'Later', hint: 'Neither', tone: 'border-line' },
];

/** Eisenhower matrix: important = P1/P2 or starred; urgent = due by tomorrow. */
export function TaskMatrix({
  todos,
  today,
  selectedId,
  onSelect,
}: {
  todos: Todo[];
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const open = todos.filter((t) => t.status !== 'done');
  return (
    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-3 p-4">
      {QUADRANTS.map((q, i) => {
        const items = open.filter((t) => quadrant(t, today) === i);
        return (
          <section
            key={q.title}
            aria-label={q.title}
            className={clsx('flex min-h-0 flex-col rounded-md border bg-surface-2/40', q.tone)}
          >
            <header className="flex items-baseline gap-2 px-3 py-2">
              <h2 className="font-code text-xs font-semibold tracking-widest text-ink-100 uppercase">
                {q.title}
              </h2>
              <span className="text-xs text-ink-500">{q.hint}</span>
              <span className="ml-auto text-xs text-ink-500">{items.length}</span>
            </header>
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
              {items.map((t) => (
                <Card
                  key={t.id}
                  todo={t}
                  today={today}
                  selected={t.id === selectedId}
                  onSelect={() => onSelect(t.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
