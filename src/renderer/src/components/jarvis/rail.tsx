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
  return (
    <nav
      aria-label="Main"
      className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-night-600 bg-night-950 py-3"
    >
      {ITEMS.map(({ view: v, label, Icon }) => (
        <IconButton
          key={v}
          label={label}
          active={view === v}
          aria-current={view === v ? 'page' : undefined}
          onClick={() => go(v)}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden />
        </IconButton>
      ))}
    </nav>
  );
}
