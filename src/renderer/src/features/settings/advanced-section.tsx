import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { SettingInput } from './settings-controls';

export function AdvancedSection(): React.JSX.Element {
  const [result, setResult] = useState<string | null>(null);
  return (
    <>
      <Section
        title="Limits"
        description="Jarvis stops and reports when a task needs more steps than this."
      >
        <div className="flex flex-wrap gap-6">
          <SettingInput k="agent.maxIterations" label="Steps per request" type="number" step={1} />
          <SettingInput
            k="agent.computerMaxActions"
            label="Actions per computer-control task"
            type="number"
            step={5}
          />
          <SettingInput
            k="budget.perTurnInputTokens"
            label="Input tokens per request"
            type="number"
            step={10000}
          />
        </div>
      </Section>
      <Section
        title="Computer control"
        description="Checks that clicks land where Jarvis aims at your display scaling. The mouse pointer moves briefly."
      >
        <div className="flex items-center gap-3">
          <Button
            onClick={() =>
              void call('computer:calibrate', {})
                .then((r) =>
                  setResult(
                    r.ok
                      ? `✓ Clicks are accurate (within ${r.maxErrorPx} px).`
                      : `✗ Clicks may be off by ${r.maxErrorPx} px. Check Windows display scaling.`,
                  ),
                )
                .catch((e: unknown) => setResult(cleanError(e)))
            }
          >
            Check click accuracy
          </Button>
          {result && (
            <p role="status" className="text-sm text-ink-300">
              {result}
            </p>
          )}
        </div>
      </Section>
      <LogsPanel />
    </>
  );
}

/** Logs (idea from isair/jarvis): what Jarvis did and why something failed, without opening files. */
function LogsPanel(): React.JSX.Element {
  const [rows, setRows] = useState<Res<'logs:tail'>>([]);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const refresh = useCallback(() => void call('logs:tail', { lines: 300 }).then(setRows), []);
  useEffect(refresh, [refresh]);
  const shown = (problemsOnly ? rows.filter((r) => r.level !== 'info') : rows).slice().reverse();
  return (
    <Section
      title="Logs"
      description="Newest first. Secrets are removed before anything is written. Useful when the wake word, a model download or a connection misbehaves."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={refresh}>Refresh</Button>
        <Button variant="ghost" onClick={() => setProblemsOnly((v) => !v)}>
          {problemsOnly ? 'Show everything' : 'Warnings and errors only'}
        </Button>
        <Button variant="ghost" onClick={() => void call('app:openFolder', { which: 'logs' })}>
          Open logs folder
        </Button>
      </div>
      <ol
        aria-label="Log lines"
        className="max-h-96 overflow-y-auto rounded-sm border border-line bg-surface-2 p-2 font-code text-xs"
      >
        {shown.length === 0 && <li className="text-ink-500">Nothing logged yet.</li>}
        {shown.map((r, i) => (
          <li key={`${r.time}-${i}`} className="py-0.5 break-all">
            <span className="text-ink-500">{r.time.slice(11, 19)}</span>{' '}
            <span
              className={clsx(
                r.level === 'error' || r.level === 'fatal'
                  ? 'text-alarm-500'
                  : r.level === 'warn'
                    ? 'text-lamp-400'
                    : 'text-ink-300',
              )}
            >
              {r.level}
            </span>{' '}
            {r.module && <span className="text-accent-300">{r.module}</span>}{' '}
            <span className="text-ink-100">{r.text}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
