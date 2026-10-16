import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { ToolCallCard } from '../../components/jarvis/tool-call-card';
import { Button } from '../../components/ui/button';
import { PageBody, PageHeader } from '../../components/ui/page';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { UsagePanel } from './usage-panel';

type Tab = 'actions' | 'audit' | 'usage';
const TAB_LABEL: Record<Tab, string> = { actions: 'Actions', audit: 'Audit log', usage: 'Usage' };

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
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Activity" help="settings.activity">
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
      </PageHeader>

      <PageBody className="flex flex-col gap-4">
        <div role="tablist" className="-mt-2 flex gap-5 border-b border-line">
          {(['actions', 'audit', 'usage'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx(
                // §6.6: underline tabs.
                '-mb-px border-b-2 pb-2.5 text-ui font-medium transition-colors duration-[120ms]',
                tab === t
                  ? 'border-ink-100 text-ink-100'
                  : 'border-transparent text-ink-500 hover:text-ink-100',
              )}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {tab === 'audit' && verify && (
          <p
            role="status"
            className={clsx(
              'rounded-md p-3 text-sm',
              verify.ok ? 'bg-surface-2 text-ok-400' : 'bg-alarm-tint text-alarm-500',
            )}
          >
            {verify.ok
              ? `✓ Chain intact (${verify.checked} entries).`
              : `✗ Chain broken at entry ${verify.brokenAt ?? '?'}; the log was modified outside Jarvis.`}
          </p>
        )}

        {tab === 'usage' ? (
          <UsagePanel />
        ) : tab === 'actions' ? (
          <ol className="flex flex-col gap-1.5">
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
                <tr key={a.seq} className="border-t border-line align-top">
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
      </PageBody>
    </div>
  );
}
