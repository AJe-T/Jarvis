import { useState } from 'react';
import clsx from 'clsx';
import { ToolCallCard } from '../../components/jarvis/tool-call-card';
import { useChatStore } from '../../stores/chat-store';
import { useUiStore } from '../../stores/ui-store';

const FILTERS = [
  ['all', 'All'],
  ['attention', 'Needs you'],
  ['error', 'Failed'],
] as const;

/** Design-system.md §5.6: live tool timeline for the current conversation. */
export function ActivityDrawer(): React.JSX.Element {
  const activity = useChatStore((s) => s.activity);
  const go = useUiStore((s) => s.go);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const shown = activity.filter((c) =>
    filter === 'all'
      ? true
      : filter === 'error'
        ? c.status === 'error' || c.decision === 'blocked'
        : c.status === 'awaiting',
  );
  return (
    <aside
      aria-label="Activity"
      // §6.10: a column beside the chat from lg; a sheet over the page below that.
      className="panel flex w-80 shrink-0 flex-col overflow-hidden border-l border-line xl:w-90 max-lg:fixed max-lg:inset-y-2 max-lg:right-2 max-lg:z-30 max-lg:w-[min(340px,88%)] max-lg:rounded-lg max-lg:border max-lg:shadow-pop"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-subtle px-4">
        <h2 className="text-ui font-semibold text-ink-100">Activity</h2>
        <button
          type="button"
          className="text-sm text-accent-300 underline-offset-2 hover:underline"
          onClick={() => go('activity')}
        >
          Open full log
        </button>
      </div>
      <div className="flex gap-1.5 px-4 py-3" role="group" aria-label="Filter activity">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={clsx(
              // §6.6: Notion pill tabs; the active one is solid ink.
              'h-7 rounded-pill border px-3 text-xs font-medium transition-colors duration-[120ms]',
              filter === id
                ? 'border-ink-strong bg-ink-strong text-on-strong'
                : 'border-line text-ink-300 hover:bg-hover hover:text-ink-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-4 pb-4">
        {shown.length === 0 && (
          <li className="px-1 py-4 text-sm text-ink-500">Actions Jarvis takes appear here.</li>
        )}
        {[...shown].reverse().map((c) => (
          <li key={c.id}>
            <ToolCallCard call={c} compact />
          </li>
        ))}
      </ol>
    </aside>
  );
}
