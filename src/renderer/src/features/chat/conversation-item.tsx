import { useState } from 'react';
import { NotebookText, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ConversationSummary } from '@shared/types';
import { call } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';
import { useUiStore } from '../../stores/ui-store';
import { confirmAction } from '../../components/ui/confirm-modal';

const ACTION =
  'rounded-sm p-1.5 text-ink-500 hover:text-ink-100 focus-visible:text-ink-100 focus-visible:outline-none';

function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * One chat in Conversations (v2.63): open it, or hover for Pin, Rename, Open in Obsidian and Delete.
 * Double-click the title to rename it too; Enter saves, Esc leaves it as it was.
 */
export function ConversationItem({
  c,
  active,
}: {
  c: ConversationSummary;
  active: boolean;
}): React.JSX.Element {
  const open = useChatStore((s) => s.open);
  const remove = useChatStore((s) => s.deleteConversation);
  const rename = useChatStore((s) => s.rename);
  const pin = useChatStore((s) => s.pin);
  const toast = useUiStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const title = c.title ?? 'New conversation';
  const fail = (e: unknown): void =>
    toast({ level: 'error', message: e instanceof Error ? e.message : String(e) });

  function save(value: string): void {
    setEditing(false);
    void rename(c.id, value).catch(fail);
  }

  return (
    <li className="group relative">
      {editing ? (
        <input
          aria-label="Conversation name"
          defaultValue={c.title ?? ''}
          maxLength={120}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => save(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(e.currentTarget.value);
            if (e.key === 'Escape') setEditing(false);
          }}
          className="inset w-full rounded-md px-2.5 py-2 text-sm text-ink-100"
        />
      ) : (
        <button
          type="button"
          onClick={() => void open(c.id)}
          onDoubleClick={() => setEditing(true)}
          aria-current={active ? 'true' : undefined}
          className={clsx(
            'flex w-full flex-col rounded-md px-2.5 py-2 text-left',
            active ? 'bg-selected' : 'hover:bg-hover',
          )}
        >
          <span className="flex items-center gap-1.5 truncate text-sm text-ink-100">
            {c.pinned && <Pin size={12} className="shrink-0 text-accent-300" aria-label="Pinned" />}
            <span className="truncate">{title}</span>
          </span>
          <span className="text-xs text-ink-500">{when(c.lastActiveAt)}</span>
        </button>
      )}
      {!editing && (
        <div className="absolute top-1.5 right-1.5 hidden items-center rounded-md bg-surface-1/95 group-focus-within:flex group-hover:flex">
          <button
            type="button"
            aria-label={c.pinned ? `Unpin ${title}` : `Pin ${title}`}
            title={c.pinned ? 'Unpin' : 'Pin to the top'}
            onClick={() => void pin(c.id, !c.pinned).catch(fail)}
            className={ACTION}
          >
            {c.pinned ? <PinOff size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
          </button>
          <button
            type="button"
            aria-label={`Rename ${title}`}
            title="Rename"
            onClick={() => setEditing(true)}
            className={ACTION}
          >
            <Pencil size={14} aria-hidden />
          </button>
          {c.vaultLogPath && (
            <button
              type="button"
              aria-label={`Open ${title} in Obsidian`}
              title="Open the day's conversation log in Obsidian"
              onClick={() => void call('memory:openInObsidian', { vaultPath: c.vaultLogPath })}
              className={ACTION}
            >
              <NotebookText size={14} aria-hidden />
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete conversation ${c.title ?? ''}`}
            onClick={() =>
              void confirmAction({
                title: `Delete "${title}"?`,
                body: "This removes the conversation from Jarvis's history. Notes already saved to Obsidian stay.",
                actionLabel: 'Delete conversation',
                destructive: true,
              }).then((ok) => (ok ? remove(c.id) : undefined))
            }
            className={clsx(ACTION, 'hover:text-alarm-500')}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}
