import { useEffect, useState } from 'react';
import type { AssistantState } from '@shared/types';
import { Orb } from '../../components/jarvis/orb';
import { call } from '../../lib/api';

/** Design-system.md §4.3 mini mode: orb only, drag to move, click to expand, caption while replying. */
export function MiniOrb(): React.JSX.Element {
  const [state, setState] = useState<AssistantState>('IDLE');
  const [level, setLevel] = useState(0);
  const [caption, setCaption] = useState('');

  useEffect(() => {
    const on = window.jarvis.on;
    const subs = [
      on('assistant:state', (p) => {
        setState(p.state);
        if (p.state === 'IDLE' || p.state === 'LISTENING') setTimeout(() => setCaption(''), 4000);
      }),
      on('voice:level', (p) => setLevel(p.rms)),
      on('chat:delta', (p) =>
        setCaption((c) => (c + p.textDelta).replace(/<\/?spoken>/g, '').slice(-140)),
      ),
      on('chat:message', (p) => {
        if (p.message.role === 'user') setCaption('');
      }),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  return (
    <div
      className="flex h-screen items-center justify-end gap-2 pr-1"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {caption && (
        <p
          className="fade-in line-clamp-2 max-w-[200px] rounded-lg border border-glass-border-strong bg-solid-float/90 px-3 py-2 text-sm text-ink-100 shadow-float"
          aria-live="polite"
        >
          {caption}
        </p>
      )}
      <button
        type="button"
        aria-label="Open Jarvis"
        title="Open Jarvis (drag the edge to move)"
        onClick={() => void call('app:setMiniMode', { on: false })}
        // §5.5: a small glass halo. A transparent window cannot blur the desktop, so the halo is tinted, not blurred.
        className="rounded-pill border border-glass-border-strong bg-solid-float/75 p-1 shadow-[inset_0_1px_0_var(--glass-highlight),var(--shadow-float)] transition-transform duration-200 motion-safe:hover:scale-[1.03]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Orb state={state} level={level} size="md" />
      </button>
    </div>
  );
}
