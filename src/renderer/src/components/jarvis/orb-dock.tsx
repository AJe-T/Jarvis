import { captionOf, STATUS_LINE } from '../../features/chat/caption';
import { useAssistantStore } from '../../stores/assistant-store';
import { useChatStore } from '../../stores/chat-store';
import { useUiStore } from '../../stores/ui-store';
import { LiveOrb } from './orb';

/**
 * Design-system.md §5.6: on every screen but Core the orb floats in the corner, live with
 * Jarvis's state and voice, with his words beside it while he replies. Click returns to Core.
 */
export function OrbDock(): React.JSX.Element | null {
  const view = useUiStore((s) => s.view);
  const go = useUiStore((s) => s.go);
  const live = useChatStore((s) => s.live);
  const state = useAssistantStore((s) => s.state);
  if (view === 'chat') return null;
  const caption = live?.text ? captionOf(live.text, 140) : '';
  return (
    <div className="pointer-events-none absolute right-5 bottom-5 z-30 flex items-end gap-3">
      {caption && (
        <p aria-hidden className="popover fade-in max-w-[260px] px-3 py-2 text-sm text-ink-100">
          {caption}
        </p>
      )}
      <button
        type="button"
        aria-label="Open Jarvis core"
        title={`Jarvis · ${STATUS_LINE[state]}`}
        onClick={() => go('chat')}
        className="orb-dock pointer-events-auto"
      >
        <LiveOrb size="dock" announce={false} />
      </button>
    </div>
  );
}
