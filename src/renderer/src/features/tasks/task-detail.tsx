import { useEffect, useState } from 'react';
import { CalendarPlus, Flag, Plus, Star, Timer, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { Todo, TodoList, TodoPatch } from '@shared/planner';
import { addMinutes, toDateKey } from '@shared/planner-time';
import { Button, IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call } from '../../lib/api';
import { plannerCall } from '../../stores/planner-store';
import { useStageStore } from '../../stores/stage-store';
import { useUiStore } from '../../stores/ui-store';
import { PRIORITY, RepeatPicker, selectClass } from './planner-kit';
import { CheckCircle } from './task-row';

const save = (id: string, patch: Omit<TodoPatch, 'id'>): void =>
  void plannerCall(call('todos:save', { id, ...patch }));

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[88px_1fr] items-start gap-3 py-1.5">
      <span className="pt-1.5 text-xs font-medium tracking-wide text-ink-500 uppercase">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The task editor beside the list: every field saves as Sir changes it. */
export function TaskDetail({
  todo,
  lists,
  subtasks,
  onClose,
}: {
  todo: Todo;
  lists: TodoList[];
  subtasks: Todo[];
  onClose: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(todo.title);
  const [notes, setNotes] = useState(todo.notes);
  const [tag, setTag] = useState('');
  const [sub, setSub] = useState('');
  useEffect(() => {
    setTitle(todo.title);
    setNotes(todo.notes);
  }, [todo.id, todo.title, todo.notes]);

  const dueStamp = todo.dueDate ? `${todo.dueDate}T${todo.dueTime ?? '09:00'}` : null;
  const set = (patch: Omit<TodoPatch, 'id'>): void => save(todo.id, patch);

  return (
    <aside
      aria-label="Task details"
      className="flex w-[22rem] shrink-0 flex-col border-l border-line-subtle bg-main xl:w-[26rem]"
    >
      <header
        data-titlebar
        className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pr-2 pl-4"
      >
        <CheckCircle todo={todo} size={20} />
        <span className="truncate text-xs text-ink-500">
          {todo.completedAt
            ? `Done ${new Date(todo.completedAt).toLocaleString()}`
            : `Created ${new Date(todo.createdAt).toLocaleDateString()}`}
        </span>
        <IconButton
          label="Delete task"
          className="ml-auto"
          onClick={() =>
            void confirmAction({
              title: 'Delete this task?',
              body: `"${todo.title}"${subtasks.length ? ` and its ${subtasks.length} subtasks` : ''} will be deleted.`,
              actionLabel: 'Delete',
              destructive: true,
            }).then(
              (ok) => void (ok && plannerCall(call('todos:delete', { id: todo.id })).then(onClose)),
            )
          }
        >
          <Trash2 size={15} aria-hidden />
        </IconButton>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <textarea
          aria-label="Title"
          value={title}
          rows={2}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== todo.title && set({ title: title.trim() })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="w-full resize-none bg-transparent text-lg font-semibold text-ink-100 outline-none focus-visible:outline-none"
        />
        <div
          className="mb-3 flex gap-1 rounded-md bg-surface-2 p-1"
          role="radiogroup"
          aria-label="Status"
        >
          {(['todo', 'doing', 'done'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={todo.status === s}
              onClick={() => set({ status: s })}
              className={clsx(
                'flex-1 rounded-sm py-1 text-xs font-medium transition-colors',
                todo.status === s
                  ? 'bg-surface-1 text-ink-100 shadow-sm'
                  : 'text-ink-500 hover:text-ink-100',
              )}
            >
              {s === 'todo' ? 'To do' : s === 'doing' ? 'Doing' : 'Done'}
            </button>
          ))}
        </div>

        <Row label="List">
          <select
            aria-label="List"
            className={clsx(selectClass, 'w-full')}
            value={todo.listId ?? ''}
            onChange={(e) => set({ listId: e.target.value || null })}
          >
            <option value="">📥 Inbox</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {`${l.icon} ${l.name}`.trim()}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Priority">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={todo.priority === p}
                aria-label={PRIORITY[p]?.label}
                title={PRIORITY[p]?.label}
                onClick={() => set({ priority: p })}
                className={clsx(
                  'flex h-8 flex-1 items-center justify-center gap-1 rounded-sm border text-xs transition-colors',
                  todo.priority === p
                    ? 'border-accent-edge bg-selected'
                    : 'border-line hover:bg-hover',
                  PRIORITY[p]?.className,
                )}
              >
                <Flag size={12} aria-hidden fill={p < 4 ? 'currentColor' : 'none'} /> P{p}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Due">
          <div className="flex flex-wrap gap-1.5">
            <input
              type="date"
              aria-label="Due date"
              className={selectClass}
              value={todo.dueDate ?? ''}
              onChange={(e) => set({ dueDate: e.target.value || null })}
            />
            <input
              type="time"
              aria-label="Due time"
              className={selectClass}
              disabled={!todo.dueDate}
              value={todo.dueTime ?? ''}
              onChange={(e) => set({ dueTime: e.target.value || null })}
            />
            {!todo.dueDate && (
              <>
                <Button
                  className="h-8 px-2"
                  onClick={() => set({ dueDate: toDateKey(new Date()) })}
                >
                  Today
                </Button>
                <Button
                  className="h-8 px-2"
                  onClick={() => set({ dueDate: toDateKey(new Date(Date.now() + 86_400_000)) })}
                >
                  Tomorrow
                </Button>
              </>
            )}
          </div>
        </Row>
        <Row label="Remind">
          <div className="flex flex-col gap-1.5">
            <input
              type="datetime-local"
              aria-label="Reminder"
              className={selectClass}
              value={todo.remindAt ?? ''}
              onChange={(e) =>
                set({ remindAt: e.target.value ? e.target.value.slice(0, 16) : null })
              }
            />
            {dueStamp && (
              <div className="flex flex-wrap gap-1">
                {[0, 15, 60, 1440].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set({ remindAt: addMinutes(dueStamp, -m) })}
                    className="rounded-pill border border-line px-2 py-0.5 text-xs text-ink-300 hover:bg-hover"
                  >
                    {m === 0
                      ? 'At due time'
                      : m === 1440
                        ? '1 day before'
                        : m === 60
                          ? '1 h before'
                          : `${m} min before`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Row>
        <Row label="Repeat">
          <RepeatPicker
            value={todo.recurrence}
            startDate={todo.dueDate}
            onChange={(r) =>
              set({
                recurrence: r,
                ...(r && !todo.dueDate ? { dueDate: toDateKey(new Date()) } : {}),
              })
            }
          />
        </Row>
        <Row label="Tags">
          <div className="flex flex-wrap items-center gap-1">
            {todo.tags.map((t) => (
              <button
                key={t}
                type="button"
                aria-label={`Remove tag ${t}`}
                onClick={() => set({ tags: todo.tags.filter((x) => x !== t) })}
                className="inline-flex items-center gap-1 rounded-pill bg-accent-tint px-2 py-0.5 text-xs text-accent-tag-ink hover:line-through"
              >
                #{t}
              </button>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = tag.trim().replace(/^#/, '');
                if (v && !todo.tags.includes(v)) set({ tags: [...todo.tags, v].slice(0, 20) });
                setTag('');
              }}
            >
              <input
                aria-label="Add tag"
                placeholder="+ tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="h-7 w-24 rounded-sm bg-transparent px-1 text-xs text-ink-100 outline-none focus-visible:outline-none placeholder:text-ink-500 focus:bg-surface-2"
              />
            </form>
          </div>
        </Row>
        <Row label="Star">
          <button
            type="button"
            aria-pressed={todo.starred}
            onClick={() => set({ starred: !todo.starred })}
            className={clsx(
              'inline-flex items-center gap-1.5 text-sm',
              todo.starred ? 'text-lamp-400' : 'text-ink-500 hover:text-ink-100',
            )}
          >
            <Star size={14} aria-hidden fill={todo.starred ? 'currentColor' : 'none'} />{' '}
            {todo.starred ? 'Starred' : 'Not starred'}
          </button>
        </Row>

        {!todo.parentId && (
          <section className="mt-3">
            <h3 className="mb-1 text-xs font-medium tracking-wide text-ink-500 uppercase">
              Subtasks{' '}
              {subtasks.length > 0 &&
                `· ${subtasks.filter((s) => s.status === 'done').length}/${subtasks.length}`}
            </h3>
            {subtasks.length > 0 && (
              <div className="mb-2 h-1 overflow-hidden rounded-pill bg-surface-2">
                <div
                  className="h-full bg-accent-500 transition-[width]"
                  style={{
                    width: `${(subtasks.filter((s) => s.status === 'done').length / subtasks.length) * 100}%`,
                  }}
                />
              </div>
            )}
            <ul>
              {subtasks.map((s) => (
                <li key={s.id} className="group flex items-center gap-2 py-1">
                  <CheckCircle todo={s} size={16} />
                  <span
                    className={clsx(
                      'flex-1 truncate text-sm',
                      s.status === 'done' ? 'text-ink-500 line-through' : 'text-ink-100',
                    )}
                  >
                    {s.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Delete subtask ${s.title}`}
                    onClick={() => void plannerCall(call('todos:delete', { id: s.id }))}
                    className="text-ink-500 opacity-0 group-hover:opacity-100 hover:text-alarm-500"
                  >
                    <X size={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex items-center gap-2 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (sub.trim())
                  void plannerCall(call('todos:save', { title: sub.trim(), parentId: todo.id }));
                setSub('');
              }}
            >
              <Plus size={14} aria-hidden className="text-ink-500" />
              <input
                aria-label="Add a subtask"
                placeholder="Add a subtask"
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                className="flex-1 bg-transparent text-sm text-ink-100 outline-none focus-visible:outline-none placeholder:text-ink-500"
              />
            </form>
          </section>
        )}

        <section className="mt-4">
          <h3 className="mb-1 text-xs font-medium tracking-wide text-ink-500 uppercase">Notes</h3>
          <textarea
            aria-label="Notes"
            value={notes}
            rows={6}
            placeholder="Details, links, Markdown…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== todo.notes && set({ notes })}
            className="w-full resize-y rounded-sm border border-line bg-surface-1 p-2 text-sm text-ink-100 outline-none focus-visible:outline-none focus:border-accent-edge"
          />
        </section>
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-line-subtle p-3">
        <Button
          onClick={() => {
            useStageStore.getState().show({
              kind: 'pomodoro',
              minutes: 25,
              breakMinutes: 5,
              label: todo.title.slice(0, 80),
            });
            if (todo.status === 'todo') set({ status: 'doing' });
          }}
        >
          <Timer size={14} aria-hidden /> Focus 25 min
        </Button>
        {todo.dueDate && (
          <Button
            onClick={() => {
              const start = `${todo.dueDate}T${todo.dueTime ?? '09:00'}`;
              void plannerCall(
                call('calendar:save', {
                  title: todo.title,
                  start,
                  end: addMinutes(start, todo.durationMin ?? 30),
                  notes: todo.notes,
                }),
              ).then(
                (ev) =>
                  ev &&
                  useUiStore
                    .getState()
                    .toast({ level: 'info', message: `"${todo.title}" is on the calendar.` }),
              );
            }}
          >
            <CalendarPlus size={14} aria-hidden /> Time-block it
          </Button>
        )}
      </footer>
    </aside>
  );
}
