import clsx from 'clsx';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { useMcpIssues } from '../../stores/mcp-store';

const VOICE_LABEL = { off: 'off', ptt: 'press to talk', wake: 'wake word' } as const;

function modelLabel(id: string | undefined): string {
  if (!id) return '—';
  const m = /claude-(\w+)-(\d+)-(\d+)/.exec(id);
  return m?.[1] ? `${m[1][0]?.toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id;
}

/** Design-system.md §5.6. */
export function StatusBar(): React.JSX.Element {
  const voice = useSetting('voice.mode');
  const lastModel = useSettingsStore((s) => s.lastModel);
  const defaultModel = useSetting('models.default');
  const model = lastModel ?? defaultModel;
  const day = useSettingsStore((s) => s.dayCostUsd);
  const budget = useSetting('budget.dailyUsd') ?? 2;
  const online = useUiStore((s) => s.online);
  const mcpIssues = useMcpIssues();
  const ratio = budget > 0 ? day / budget : 0;
  return (
    <footer
      className="flex h-8 shrink-0 items-center gap-4 border-t border-night-600 bg-night-950 px-4 text-xs text-ink-300"
      aria-label="Status"
    >
      <span>Voice: {voice ? VOICE_LABEL[voice] : '—'}</span>
      <span aria-hidden>·</span>
      <span>{modelLabel(model)}</span>
      <span aria-hidden>·</span>
      <span
        className={clsx(
          'tabular',
          ratio >= 1 ? 'text-alarm-500' : ratio >= 0.8 ? 'text-lamp-400' : '',
        )}
      >
        Today ${day.toFixed(2)} / ${budget.toFixed(2)}
      </span>
      {mcpIssues > 0 && (
        <>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="text-lamp-400 underline-offset-2 hover:underline"
            onClick={() => useUiStore.getState().go('connections')}
          >
            {mcpIssues} connection {mcpIssues === 1 ? 'issue' : 'issues'}
          </button>
        </>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <span
          className={clsx('size-2 rounded-pill', online ? 'bg-ok-400' : 'bg-alarm-500')}
          aria-hidden
        />
        {online ? 'Online' : 'Offline'}
      </span>
    </footer>
  );
}
