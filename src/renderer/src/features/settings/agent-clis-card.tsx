import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { call } from '../../lib/api';

type AgentCli = Res<'llm:agentClis'>[number];

const USE_LABEL: Record<AgentCli['use'], string> = {
  'main-brain': 'Can be Jarvis’s connection',
  'answer-brain': 'Used for sub-tasks and NPCs',
  detected: 'Found only; Jarvis doesn’t use it yet',
};

/** Coding agents on this PC: found by file name only (nothing is run, no sign-in data is read). */
export function AgentClisCard(): React.JSX.Element {
  const [apps, setApps] = useState<AgentCli[] | null>(null);
  const refresh = useCallback(async () => setApps(await call('llm:agentClis', {})), []);
  useEffect(() => void refresh(), [refresh]);
  if (!apps) return <span className="skeleton block h-16 w-full" aria-hidden />;
  const sorted = [...apps].sort((a, b) => Number(b.installed) - Number(a.installed));
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid gap-2 sm:grid-cols-2">
        {sorted.map((a) => (
          <li key={a.id} className="flex flex-col gap-1 rounded-md border border-line p-3">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-ink-100">{a.label}</span>
              <span className="text-xs text-ink-500">{a.vendor}</span>
            </span>
            <span
              role="status"
              className={clsx('text-sm', a.installed ? 'text-ok-400' : 'text-ink-300')}
            >
              {a.installed
                ? `✓ Installed${a.version ? ` · v${a.version}` : ''}`
                : 'Not found on this PC'}
            </span>
            {a.installed ? (
              <span className="text-xs text-ink-300">{USE_LABEL[a.use]}</span>
            ) : (
              <code className="break-all text-xs text-ink-300">{a.install}</code>
            )}
            {a.note && <span className="text-xs text-lamp-400">{a.note}</span>}
            <button
              type="button"
              className="self-start text-xs text-accent-300 underline"
              onClick={() => void call('app:openExternal', { url: a.docsUrl })}
            >
              Official docs
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" className="self-start" onClick={() => void refresh()}>
        Check again
      </Button>
    </div>
  );
}
