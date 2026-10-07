import { useEffect, useState } from 'react';
import { Orb } from '../../components/jarvis/orb';
import { call } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';
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

/** Design-system.md §4.2: large orb, one line, three suggestion chips from routines. */
export function EmptyState(): React.JSX.Element {
  const state = useAssistantStore((s) => s.state);
  const level = useAssistantStore((s) => (s.state === 'SPEAKING' ? s.outLevel : s.micLevel));
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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-3 md:px-6">
      <Orb state={state} level={level} size="lg" />
      <h1 className="font-display text-xl font-semibold text-ink-100">{greeting()}</h1>
      <div className="flex flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => void send(c)}
            className="glass-inset min-h-8 rounded-pill px-4 text-sm text-ink-300 transition-colors duration-[120ms] hover:text-ink-100"
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
