import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { ToolCallCard } from '../../components/jarvis/tool-call-card';
import { Button } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';

type Tab = 'actions' | 'audit';

/** Full Activity log (Rail → Activity): every tool call, plus the tamper-evident audit log. */
export function ActivityView(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('actions');
  const [calls, setCalls] = useState<Res<'activity:list'>>([]);
  const [audit, setAudit] = useState<Res<'audit:list'>['items']>([]);
  const [verify, setVerify] = useState<Res<'audit:verify'> | null>(null);
  const toast = useUiStore((s) => s.toast);

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([
      call('activity:list', { limit: 300 }),
      call('audit:list', { limit: 300 }),
    ]);
    setCalls(c);
    setAudit(a.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-night-900">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-night-600 px-6">
        <h1 className="font-display text-lg font-semibold">Activity</h1>
        <div role="tablist" className="flex gap-1">
          {(['actions', 'audit'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx(
                'min-h-8 rounded-pill px-3 text-sm',
                tab === t ? 'bg-night-700 text-ink-100' : 'text-ink-300 hover:text-ink-100',
              )}
            >
              {t === 'actions' ? 'Actions' : 'Audit log'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden /> Refresh
          </Button>
          {tab === 'audit' && (
            <>
              <Button onClick={() => void call('audit:verify', {}).then(setVerify)}>
                <ShieldCheck size={14} aria-hidden /> Verify chain
              </Button>
              <Button
                onClick={() =>
                  void call('audit:export', {})
                    .then(
                      (r) =>
                        r.path && toast({ level: 'info', message: `Audit log saved to ${r.path}` }),
                    )
                    .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
                }
              >
                Export JSON
              </Button>
            </>
          )}
        </div>
      </header>

      {tab === 'audit' && verify && (
        <p
          role="status"
          className={clsx(
            'mx-6 mt-3 rounded-sm border p-2 text-sm',
            verify.ok ? 'border-ok-400 text-ok-400' : 'border-alarm-500 text-alarm-500',
          )}
        >
          {verify.ok
            ? `✓ Chain intact (${verify.checked} entries).`
            : `✗ Chain broken at entry ${verify.brokenAt ?? '?'}; the log was modified outside Jarvis.`}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tab === 'actions' ? (
          <ol className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {calls.length === 0 && <li className="text-sm text-ink-500">No actions yet.</li>}
            {calls.map((c) => (
              <li key={c.id} className="flex items-start gap-3">
                <time
                  className="w-28 shrink-0 pt-2 text-xs text-ink-500 tabular"
                  dateTime={c.createdAt}
                >
                  {new Date(c.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                <div className="min-w-0 flex-1">
                  <ToolCallCard call={c} />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <table className="w-full text-left text-sm tabular">
            <thead className="text-ink-500">
              <tr>
                <th className="py-1 pr-3 font-medium">#</th>
                <th className="py-1 pr-3 font-medium">Time</th>
                <th className="py-1 pr-3 font-medium">Actor</th>
                <th className="py-1 pr-3 font-medium">Event</th>
                <th className="py-1 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.seq} className="border-t border-night-600 align-top">
                  <td className="py-1.5 pr-3 text-ink-500">{a.seq}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-ink-300">
                    {new Date(a.ts).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-300">{a.actor}</td>
                  <td className="py-1.5 pr-3 text-ink-100">{a.event}</td>
                  <td className="py-1.5 font-code text-xs break-all text-ink-300">{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
