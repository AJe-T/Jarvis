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
      className="flex w-80 shrink-0 flex-col border-l border-night-600 bg-night-950"
    >
      <div className="flex h-14 items-center justify-between px-4">
        <h2 className="font-display text-sm font-semibold text-ink-300">Activity</h2>
        <button
          type="button"
          className="text-sm text-reactor-500 hover:underline"
          onClick={() => go('activity')}
        >
          Open full log
        </button>
      </div>
      <div className="flex gap-1 px-3 pb-2" role="group" aria-label="Filter activity">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={clsx(
              'min-h-7 rounded-pill px-2.5 text-xs',
              filter === id ? 'bg-night-700 text-ink-100' : 'text-ink-500 hover:text-ink-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-3">
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
