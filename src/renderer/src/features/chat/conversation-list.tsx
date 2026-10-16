import { useEffect, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { call } from '../../lib/api';
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

type Hit = Res<'conversations:search'>[number];

/** FTS snippet → text with the matched words marked ([word] → <mark>). */
function Snippet({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(\[[^\]]{1,80}\])/g);
  return (
    <span className="line-clamp-2 text-xs text-ink-300">
      {parts.map((p, i) =>
        /^\[.*\]$/.test(p) ? (
          <mark key={i} className="rounded-xs bg-accent-500/25 px-0.5 text-ink-100">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

/** Search every past chat (idea from LibreChat), as you type. */
function useChatSearch(query: string): Hit[] | null {
  const [hits, setHits] = useState<Hit[] | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    let live = true;
    const t = setTimeout(() => {
      call('conversations:search', { query: q })
        .then((r) => live && setHits(r))
        .catch(() => live && setHits([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  return hits;
}

export function ConversationList({ onClose }: { onClose: () => void }): React.JSX.Element {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const open = useChatStore((s) => s.open);
  const remove = useChatStore((s) => s.deleteConversation);
  const [query, setQuery] = useState('');
  const hits = useChatSearch(query);
  return (
    <aside
      aria-label="Conversations"
      className="flex w-64 shrink-0 flex-col border-r border-line-subtle max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-10 max-md:bg-surface-1"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-subtle pr-2 pl-4">
        <h2 className="text-ui font-semibold text-ink-100">Conversations</h2>
        <IconButton label="Close conversations" onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </div>
      <div className="shrink-0 px-2 pt-2">
        <label className="flex items-center gap-2 rounded-md border border-line bg-surface-1 px-2.5 py-1.5 focus-within:border-accent-edge">
          <Search size={14} aria-hidden className="text-ink-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search all chats"
            aria-label="Search all chats"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-100 outline-none placeholder:text-ink-500"
          />
        </label>
      </div>
      {hits !== null ? (
        <ul className="flex-1 overflow-y-auto p-2" aria-label="Search results">
          {hits.length === 0 && (
            <li className="px-2 py-4 text-sm text-ink-500">No chats mention that.</li>
          )}
          {hits.map((h) => (
            <li key={h.conversationId}>
              <button
                type="button"
                onClick={() => void open(h.conversationId)}
                aria-current={h.conversationId === activeId ? 'true' : undefined}
                className={clsx(
                  'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left',
                  h.conversationId === activeId ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <span className="truncate text-sm text-ink-100">
                  {h.title ?? 'New conversation'}
                </span>
                <Snippet text={h.snippet} />
                <span className="text-3xs text-ink-500">{when(h.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex-1 overflow-y-auto p-2">
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
                  c.id === activeId ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <span className="truncate text-sm text-ink-100">
                  {c.title ?? 'New conversation'}
                </span>
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
      )}
    </aside>
  );
}
