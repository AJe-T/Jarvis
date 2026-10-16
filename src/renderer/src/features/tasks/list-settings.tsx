import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Settings2, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { Req } from '@shared/ipc-contract';
import { PLANNER_COLORS, type Todo, type TodoList } from '@shared/planner';
import { IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call } from '../../lib/api';
import { plannerCall } from '../../stores/planner-store';
import { LIST_ICONS } from './lists-home';

const save = (id: string, patch: Omit<Req<'todos:saveList'>, 'id'>): void =>
  void plannerCall(call('todos:saveList', { id, ...patch }));

/** The ⚙ on a list's page: name, description, icon, colour, Doing limit, archive, clean up, delete. */
export function ListSettings({
  list,
  todos,
  onDeleted,
}: {
  list: TodoList;
  todos: Todo[];
  onDeleted: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setName(list.name);
    setDescription(list.description);
  }, [list.name, list.description]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const done = todos.filter((t) => t.listId === list.id && t.status === 'done' && !t.parentId);

  return (
    <div ref={box} className="relative">
      <IconButton label="List settings" active={open} onClick={() => setOpen((v) => !v)}>
        <Settings2 size={15} aria-hidden />
      </IconButton>
      {open && (
        <div
          role="dialog"
          aria-label={`${list.name} settings`}
          className="popover absolute top-full right-0 z-30 mt-2 flex w-80 flex-col gap-3 p-4"
        >
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            Name
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onBlur={() =>
                name.trim() && name !== list.name && save(list.id, { name: name.trim() })
              }
              className="h-8 rounded-sm border border-line bg-surface-2 px-2 text-sm text-ink-100 focus-visible:border-accent-edge"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-500">
            Description (shown on the card)
            <textarea
              value={description}
              maxLength={500}
              rows={2}
              placeholder="What is this list for?"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== list.description && save(list.id, { description })}
              className="resize-none rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-500 focus-visible:border-accent-edge"
            />
          </label>
          <div>
            <p className="mb-1 text-xs text-ink-500">Icon</p>
            <div className="flex flex-wrap gap-1">
              {LIST_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Icon ${i}`}
                  aria-pressed={list.icon === i}
                  onClick={() => save(list.id, { icon: list.icon === i ? '' : i })}
                  className={clsx(
                    'size-7 rounded-sm hover:bg-hover',
                    list.icon === i && 'bg-selected ring-1 ring-accent-edge',
                  )}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-500">Colour</p>
            <div className="flex flex-wrap gap-1.5">
              {PLANNER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={list.color === c}
                  onClick={() => save(list.id, { color: c })}
                  className={clsx(
                    'size-5 rounded-pill',
                    list.color === c && 'ring-2 ring-ink-100 ring-offset-2 ring-offset-surface-1',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-2 text-sm text-ink-300">
            <span>
              Doing limit
              <span className="block text-xs text-ink-500">
                Warns when more tasks are in progress
              </span>
            </span>
            <select
              value={list.wipLimit ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                save(list.id, { wipLimit: v === 0 ? null : v });
              }}
              className="h-8 rounded-sm border border-line bg-surface-2 px-2 text-sm text-ink-100"
            >
              <option value={0}>No limit</option>
              {[1, 2, 3, 4, 5, 7, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 border-t border-line-subtle pt-3">
            <button
              type="button"
              onClick={() => {
                save(list.id, { archived: !list.archived });
                setOpen(false);
              }}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink-300 hover:bg-hover hover:text-ink-100"
            >
              {list.archived ? (
                <ArchiveRestore size={14} aria-hidden />
              ) : (
                <Archive size={14} aria-hidden />
              )}
              {list.archived ? 'Unarchive list' : 'Archive list (hide from Lists)'}
            </button>
            <button
              type="button"
              disabled={done.length === 0}
              onClick={() =>
                void confirmAction({
                  title: `Delete ${done.length} done task${done.length === 1 ? '' : 's'}?`,
                  body: `Completed tasks in "${list.name}" are deleted for good.`,
                  actionLabel: 'Delete done tasks',
                  destructive: true,
                }).then(async (ok) => {
                  if (!ok) return;
                  for (const t of done) await plannerCall(call('todos:delete', { id: t.id }));
                })
              }
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink-300 hover:bg-hover hover:text-ink-100 disabled:opacity-40"
            >
              <Trash2 size={14} aria-hidden /> Clear done tasks ({done.length})
            </button>
            <button
              type="button"
              onClick={() =>
                void confirmAction({
                  title: `Delete "${list.name}"?`,
                  body: 'The list goes; its tasks move to the Inbox.',
                  actionLabel: 'Delete list',
                  destructive: true,
                }).then(async (ok) => {
                  if (!ok) return;
                  await plannerCall(call('todos:deleteList', { id: list.id }));
                  onDeleted();
                })
              }
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-alarm-500 hover:bg-alarm-tint"
            >
              <Trash2 size={14} aria-hidden /> Delete list
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
