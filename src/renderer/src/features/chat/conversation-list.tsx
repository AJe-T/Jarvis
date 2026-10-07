import { Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { useChatStore } from '../../stores/chat-store';
import { IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function ConversationList({ onClose }: { onClose: () => void }): React.JSX.Element {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const open = useChatStore((s) => s.open);
  const remove = useChatStore((s) => s.deleteConversation);
  return (
    <aside
      aria-label="Conversations"
      className="flex w-64 shrink-0 flex-col border-r border-glass-border max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-10 max-md:bg-solid-float"
    >
      <div className="flex h-14 items-center justify-between px-3">
        <h2 className="text-sm font-semibold text-ink-300">Conversations</h2>
        <IconButton label="Close conversations" onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 && (
          <li className="px-2 py-4 text-sm text-ink-500">No conversations yet.</li>
        )}
        {conversations.map((c) => (
          <li key={c.id} className="group relative">
            <button
              type="button"
              onClick={() => void open(c.id)}
              aria-current={c.id === activeId ? 'true' : undefined}
              className={clsx(
                'flex w-full flex-col rounded-md px-2.5 py-2 pr-9 text-left',
                c.id === activeId ? 'bg-glass-selected' : 'hover:bg-glass-hover',
              )}
            >
              <span className="truncate text-sm text-ink-100">{c.title ?? 'New conversation'}</span>
              <span className="text-xs text-ink-500">{when(c.lastActiveAt)}</span>
            </button>
            <button
              type="button"
              aria-label={`Delete conversation ${c.title ?? ''}`}
              onClick={() =>
                void confirmAction({
                  title: `Delete "${c.title ?? 'New conversation'}"?`,
                  body: "This removes the conversation from Jarvis's history. Notes already saved to Obsidian stay.",
                  actionLabel: 'Delete conversation',
                  destructive: true,
                }).then((ok) => (ok ? remove(c.id) : undefined))
              }
              className="absolute top-2 right-1.5 hidden rounded-sm p-1.5 text-ink-500 group-focus-within:block group-hover:block hover:text-alarm-500"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
