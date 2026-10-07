import {
  Activity,
  BookOpen,
  Brain,
  MessageSquare,
  MessagesSquare,
  Plug,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { useUiStore, type View } from '../../stores/ui-store';

const ITEMS: Array<{ view: View; label: string; Icon: typeof Brain }> = [
  { view: 'chat', label: 'Chat', Icon: MessageSquare },
  { view: 'memory', label: 'Memory', Icon: Brain },
  { view: 'activity', label: 'Activity', Icon: Activity },
  { view: 'connections', label: 'Connections', Icon: Plug },
  { view: 'copilot', label: 'Reply copilot', Icon: MessagesSquare },
  { view: 'bible', label: 'Bible', Icon: BookOpen },
  { view: 'settings', label: 'Settings', Icon: Settings },
];

/** §6.2: Sidebar. Icons with labels from 1200px; icons only (with tooltips) below. */
export function Rail(): React.JSX.Element {
  const view = useUiStore((s) => s.view);
  const go = useUiStore((s) => s.go);
  const item = ({ view: v, label, Icon }: (typeof ITEMS)[number]): React.JSX.Element => (
    <button
      key={v}
      type="button"
      aria-label={label}
      title={label}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => go(v)}
      className={clsx(
        'flex h-9 w-full items-center justify-center gap-2.5 rounded-md text-sm transition-colors duration-[120ms] lg:justify-start lg:px-2.5',
        view === v
          ? 'bg-selected font-medium text-ink-100'
          : 'text-ink-300 hover:bg-hover hover:text-ink-100',
      )}
    >
      <Icon size={18} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span className="hidden truncate lg:inline">{label}</span>
    </button>
  );
  return (
    <nav
      aria-label="Main"
      className="flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-app px-2 py-2 lg:w-60"
    >
      <div className="mb-2 flex h-9 items-center justify-center gap-2.5 lg:justify-start lg:px-2.5">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-ink-strong text-xs font-semibold text-on-strong"
          aria-hidden
        >
          J
        </span>
        <span className="hidden text-sm font-semibold text-ink-100 lg:inline">Jarvis</span>
      </div>
      {ITEMS.filter((i) => i.view !== 'settings').map(item)}
      <div className="mt-auto">{ITEMS.filter((i) => i.view === 'settings').map(item)}</div>
    </nav>
  );
}
