import { Bell, Check, GripVertical, ListTree, NotebookText, Repeat, Star } from 'lucide-react';
import clsx from 'clsx';
import type { Todo, TodoList } from '@shared/planner';
import { call } from '../../lib/api';
import { plannerCall } from '../../stores/planner-store';
import { PRIORITY } from './planner-kit';
import { dueLabel, type Tone } from './task-filters';

const TONE: Record<Tone, string> = {
  overdue: 'text-alarm-500',
  today: 'text-ok-400',
  soon: 'text-lamp-400',
  later: 'text-ink-500',
};

export function toggleDone(t: Todo): void {
  void plannerCall(call('todos:save', { id: t.id, status: t.status === 'done' ? 'todo' : 'done' }));
}

/** The round check: its ring shows the priority; ticking a repeating task moves it to its next date. */
export function CheckCircle({ todo, size = 18 }: { todo: Todo; size?: number }): React.JSX.Element {
  const done = todo.status === 'done';
  return (
    <button
      type="button"
      aria-label={done ? `Mark "${todo.title}" not done` : `Complete "${todo.title}"`}
      onClick={(e) => {
        e.stopPropagation();
        toggleDone(todo);
      }}
      style={{ width: size, height: size }}
      className={clsx(
        'group/check grid shrink-0 place-items-center rounded-pill border-2 transition-colors',
        done ? 'border-accent-500 bg-accent-500 text-ink-on-accent' : PRIORITY[todo.priority]?.ring,
      )}
    >
      <Check
        size={size - 6}
        strokeWidth={3}
        aria-hidden
        className={clsx(!done && 'opacity-0 group-hover/check:opacity-60')}
      />
    </button>
  );
}

export function TaskRow({
  todo,
  today,
  lists,
  subtasks,
  selected,
  showList,
  draggable,
  onSelect,
  onDragStart,
  onDropOn,
}: {
  todo: Todo;
  today: string;
  lists: Map<string, TodoList>;
  subtasks: Todo[];
  selected: boolean;
  showList: boolean;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
}): React.JSX.Element {
  const due = dueLabel(todo, today);
  const list = todo.listId ? lists.get(todo.listId) : undefined;
  const subDone = subtasks.filter((s) => s.status === 'done').length;
  const done = todo.status === 'done';
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', todo.id);
        onDragStart();
      }}
      onDragOver={(e) => draggable && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      className={clsx(
        'group relative flex cursor-pointer items-start gap-3 border-b border-line-subtle px-3 py-2.5 transition-colors',
        selected ? 'bg-selected' : 'hover:bg-hover',
      )}
      onClick={onSelect}
    >
      {draggable && (
        <GripVertical
          size={14}
          aria-hidden
          className="absolute top-3 -left-1 text-ink-500 opacity-0 group-hover:opacity-100"
        />
      )}
      <span className="pt-0.5">
        <CheckCircle todo={todo} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'truncate text-sm',
              done ? 'text-ink-500 line-through' : 'text-ink-100',
            )}
          >
            {todo.title}
          </span>
          {todo.status === 'doing' && (
            <span className="shrink-0 rounded-pill bg-accent-tint px-1.5 text-3xs font-semibold tracking-wide text-accent-tag-ink uppercase">
              Doing
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-500">
          {due && <span className={clsx(!done && TONE[due.tone])}>{due.text}</span>}
          {todo.recurrence && <Repeat size={11} aria-label="Repeats" />}
          {todo.remindAt && !done && (
            <Bell size={11} aria-label={`Reminder ${todo.remindAt.replace('T', ' ')}`} />
          )}
          {subtasks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListTree size={11} aria-hidden /> {subDone}/{subtasks.length}
            </span>
          )}
          {todo.notes.trim() && <NotebookText size={11} aria-label="Has notes" />}
          {todo.tags.map((t) => (
            <span key={t} className="text-accent-tag-ink">
              #{t}
            </span>
          ))}
          {showList && (
            <span className="ml-auto inline-flex items-center gap-1">
              <span
                className="size-2 rounded-pill"
                style={{ background: list?.color ?? 'var(--ink-500)' }}
              />
              {list ? `${list.icon} ${list.name}`.trim() : 'Inbox'}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label={todo.starred ? 'Unstar' : 'Star'}
        aria-pressed={todo.starred}
        onClick={(e) => {
          e.stopPropagation();
          void plannerCall(call('todos:save', { id: todo.id, starred: !todo.starred }));
        }}
        className={clsx(
          'shrink-0 rounded-sm p-1 transition-opacity',
          todo.starred
            ? 'text-lamp-400'
            : 'text-ink-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        <Star size={14} aria-hidden fill={todo.starred ? 'currentColor' : 'none'} />
      </button>
    </li>
  );
}
