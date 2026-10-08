import { useEffect, useState } from 'react';
import {
  Activity,
  BookOpen,
  Brain,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  MessagesSquare,
  Network,
  Plug,
  Plus,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { NewSpaceForm } from '../../features/spaces/spaces-view';
import { useMemoryStore } from '../../stores/memory-store';
import { useSpacesStore } from '../../stores/spaces-store';
import { useUiStore, type View } from '../../stores/ui-store';

const ITEMS: Array<{ view: View; label: string; Icon: typeof Brain }> = [
  { view: 'chat', label: 'Chat', Icon: MessageSquare },
  { view: 'spaces', label: 'Spaces', Icon: LayoutGrid },
  { view: 'brain', label: 'Brain', Icon: Network },
  { view: 'memory', label: 'Memory', Icon: Brain },
  { view: 'passwords', label: 'Passwords', Icon: KeyRound },
  { view: 'activity', label: 'Activity', Icon: Activity },
  { view: 'connections', label: 'Connections', Icon: Plug },
  { view: 'copilot', label: 'Reply copilot', Icon: MessagesSquare },
  { view: 'bible', label: 'Bible', Icon: BookOpen },
  { view: 'settings', label: 'Settings', Icon: Settings },
];

const rowClass = (on: boolean): string =>
  clsx(
    'flex h-9 w-full items-center justify-center gap-2.5 rounded-md text-sm transition-colors duration-[120ms] lg:justify-start lg:px-2.5',
    on ? 'bg-selected font-medium text-ink-100' : 'text-ink-300 hover:bg-hover hover:text-ink-100',
  );

/** The user's Spaces listed under "Spaces" (labels from 1200px; icons only below). */
function SpaceList(): React.JSX.Element {
  const spaces = useSpacesStore((s) => s.spaces);
  const refresh = useSpacesStore((s) => s.refresh);
  const version = useMemoryStore((s) => s.version);
  const view = useUiStore((s) => s.view);
  const target = useUiStore((s) => s.spaceTarget);
  const go = useUiStore((s) => s.go);
  const [adding, setAdding] = useState(false);
  useEffect(() => void refresh(), [refresh, version]);
  const current = view === 'spaces' ? (target?.split('/')[0] ?? null) : null;

  return (
    <div className="mb-1 flex flex-col gap-0.5 lg:pl-3">
      {spaces.map((sp) => (
        <button
          key={sp.name}
          type="button"
          title={sp.name}
          aria-label={`Space: ${sp.name}`}
          aria-current={current === sp.name ? 'page' : undefined}
          onClick={() => go('spaces', sp.name)}
          className={clsx(rowClass(current === sp.name), 'h-8')}
        >
          <span aria-hidden className="w-4.5 shrink-0 text-center">
            {sp.icon}
          </span>
          <span className="hidden truncate lg:inline">{sp.name}</span>
        </button>
      ))}
      {adding ? (
        <div className="hidden rounded-md border border-line bg-surface-1 p-2 lg:block">
          <NewSpaceForm
            onDone={(name) => {
              setAdding(false);
              void refresh();
              if (name) go('spaces', name);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          aria-label="New space"
          title="New space"
          onClick={() => (window.innerWidth >= 1200 ? setAdding(true) : go('spaces'))}
          className={clsx(rowClass(false), 'h-8 text-ink-500')}
        >
          <Plus size={16} aria-hidden className="shrink-0" />
          <span className="hidden lg:inline">New space</span>
        </button>
      )}
    </div>
  );
}

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
      className={rowClass(view === v)}
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
      {ITEMS.filter((i) => i.view !== 'settings').map((i) => (
        <div key={i.view} className="contents">
          {item(i)}
          {i.view === 'spaces' && <SpaceList />}
        </div>
      ))}
      <div className="mt-auto">{ITEMS.filter((i) => i.view === 'settings').map(item)}</div>
    </nav>
  );
}
