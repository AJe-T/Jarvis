import { useState } from 'react';
import { Flag } from 'lucide-react';
import clsx from 'clsx';
import { TODO_STATUSES, type Todo, type TodoStatus } from '@shared/planner';
import { call } from '../../lib/api';
import { plannerCall } from '../../stores/planner-store';
import { PRIORITY } from './planner-kit';
import { dueLabel, quadrant } from './task-filters';
import { CheckCircle } from './task-row';

function Card({
  todo,
  today,
  selected,
  onSelect,
}: {
  todo: Todo;
  today: string;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const due = dueLabel(todo, today);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', todo.id);
      }}
      onClick={onSelect}
      className={clsx(
        'card flex cursor-grab items-start gap-2 p-2.5 text-sm transition-colors active:cursor-grabbing',
        selected ? 'ring-1 ring-accent-edge' : 'hover:bg-surface-2',
      )}
    >
      <CheckCircle todo={todo} size={16} />
      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            'line-clamp-2',
            todo.status === 'done' ? 'text-ink-500 line-through' : 'text-ink-100',
          )}
        >
          {todo.title}
        </p>
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
          {due && (
            <span
              className={due.tone === 'overdue' && todo.status !== 'done' ? 'text-alarm-500' : ''}
            >
              {due.text}
            </span>
          )}
          {todo.priority < 4 && (
            <Flag
              size={11}
              aria-label={`P${todo.priority}`}
              className={PRIORITY[todo.priority]?.className}
              fill="currentColor"
            />
          )}
          {todo.tags.slice(0, 2).map((t) => (
            <span key={t} className="text-accent-tag-ink">
              #{t}
            </span>
          ))}
        </div>
      </div>
    </li>
  );
}

const COLUMN: Record<TodoStatus, string> = { todo: 'To do', doing: 'Doing', done: 'Done' };

/** Kanban: drag a card to another column to change its status. */
export function TaskBoard({
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
  const [over, setOver] = useState<TodoStatus | null>(null);
  return (
    <div className="grid h-full min-h-0 grid-cols-3 gap-3 p-4">
      {TODO_STATUSES.map((s) => {
        const items = todos.filter((t) => t.status === s);
        return (
          <section
            key={s}
            aria-label={COLUMN[s]}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(s);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/plain');
              if (id && todos.find((t) => t.id === id)?.status !== s)
                void plannerCall(call('todos:save', { id, status: s }));
            }}
            className={clsx(
              'flex min-h-0 flex-col rounded-md border bg-surface-2/50 transition-colors',
              over === s ? 'border-accent-edge bg-accent-tint' : 'border-line-subtle',
            )}
          >
            <h2 className="flex items-center gap-2 px-3 py-2 font-code text-xs font-semibold tracking-widest text-ink-300 uppercase">
              <span
                className={clsx(
                  'size-2 rounded-pill',
                  s === 'todo' ? 'bg-ink-500' : s === 'doing' ? 'bg-lamp-400' : 'bg-ok-400',
                )}
              />
              {COLUMN[s]}
              <span className="ml-auto text-ink-500">{items.length}</span>
            </h2>
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {items.map((t) => (
                <Card
                  key={t.id}
                  todo={t}
                  today={today}
                  selected={t.id === selectedId}
                  onSelect={() => onSelect(t.id)}
                />
              ))}
              {items.length === 0 && (
                <li className="py-6 text-center text-xs text-ink-500">Drop tasks here</li>
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
