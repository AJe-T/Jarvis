import { Square } from 'lucide-react';
import { call } from '../../lib/api';

/** Design-system.md §4.4: 4px alarm border around the whole screen (window is click-through). */
export function OverlayBorder(): React.JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 border-4 border-alarm-fill" aria-hidden />
  );
}

/** The only clickable part of the overlay. */
export function OverlayPill(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div
        role="status"
        className="flex items-center gap-3 rounded-pill border border-alarm-fill bg-solid-float py-1.5 pr-1.5 pl-4 text-sm text-ink-100 shadow-float"
      >
        <span className="size-2 animate-pulse rounded-pill bg-alarm-fill" aria-hidden />
        Jarvis is controlling your PC
        <button
          type="button"
          onClick={() => void call('app:killSwitch', {})}
          className="flex min-h-8 items-center gap-1.5 rounded-pill bg-alarm-fill px-3 font-semibold text-ink-on-alarm hover:brightness-110"
        >
          <Square size={12} fill="currentColor" aria-hidden /> Stop (Ctrl+Alt+Shift+X)
        </button>
      </div>
    </div>
  );
}
