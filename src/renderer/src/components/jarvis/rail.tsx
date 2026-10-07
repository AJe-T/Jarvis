import {
  Activity,
  BookOpen,
  Brain,
  MessageSquare,
  MessagesSquare,
  Plug,
  Settings,
} from 'lucide-react';
import { IconButton } from '../ui/button';
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

export function Rail(): React.JSX.Element {
  const view = useUiStore((s) => s.view);
  const go = useUiStore((s) => s.go);
  const item = ({ view: v, label, Icon }: (typeof ITEMS)[number]): React.JSX.Element => (
    <IconButton
      key={v}
      label={label}
      active={view === v}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => go(v)}
      className="size-10"
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden />
    </IconButton>
  );
  return (
    // §6.2: a plain sidebar on the window colour; Settings sits at the bottom.
    <nav
      aria-label="Main"
      className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto py-[var(--shell-gap)] md:w-16"
    >
      <div
        className="mb-3 flex size-8 items-center justify-center rounded-md bg-accent-600 text-sm font-semibold text-ink-on-accent"
        aria-hidden
      >
        J
      </div>
      {ITEMS.filter((i) => i.view !== 'settings').map(item)}
      <div className="mt-auto">{ITEMS.filter((i) => i.view === 'settings').map(item)}</div>
    </nav>
  );
}
