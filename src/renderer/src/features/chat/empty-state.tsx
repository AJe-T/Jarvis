import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';

function greeting(d = new Date()): string {
  const h = d.getHours();
  const part = h < 5 ? 'evening' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${part}, sir. What shall we work on?`;
}

const FALLBACK_CHIPS = [
  "What's on my calendar today?",
  'Open VS Code and Chrome',
  'What can you do?',
];

/** Design-system.md §5.2: under the Core orb before a conversation: one line, three suggestions from routines. */
export function EmptyState(): React.JSX.Element {
  const send = useChatStore((s) => s.send);
  const [chips, setChips] = useState<string[]>(FALLBACK_CHIPS);

  useEffect(() => {
    let alive = true;
    call('routines:list', {})
      .then((routines) => {
        const fromRoutines = routines
          .filter((r) => r.enabled)
          .flatMap((r) => (r.triggers[0] ? [r.triggers[0]] : []));
        if (alive && fromRoutines.length)
          setChips([...fromRoutines, ...FALLBACK_CHIPS].slice(0, 3));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-4">
      <h1 className="text-center text-xl font-semibold text-ink-100 md:text-2xl">{greeting()}</h1>
      <div className="grid w-full gap-2 md:grid-cols-3">
        {chips.map((c, i) => (
          <button
            key={c}
            type="button"
            onClick={() => void send(c)}
            className="card group min-h-16 px-4 py-3 text-left text-ui text-ink-100 transition-colors duration-[120ms] hover:border-accent-edge hover:bg-surface-2"
          >
            <span aria-hidden className="hud-label mb-1 block group-hover:text-accent-300!">
              {`cmd.0${i + 1}`}
            </span>
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
