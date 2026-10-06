import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, RotateCw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { McpServerView, Res } from '@shared/ipc-contract';
import type { Tier } from '@shared/types';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Switch } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useMcpStore } from '../../stores/mcp-store';
import { useUiStore } from '../../stores/ui-store';
import { AddConnection } from './add-connection';

const STATUS: Record<McpServerView['status'], { label: string; dot: string }> = {
  ready: { label: 'Connected', dot: 'bg-ok-400' },
  connecting: { label: 'Connecting…', dot: 'bg-lamp-400' },
  error: { label: 'Error', dot: 'bg-alarm-500' },
  disabled: { label: 'Off', dot: 'bg-ink-500' },
};

function ServerCard({ s, onChange }: { s: McpServerView; onChange(): void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const toast = useUiStore((st) => st.toast);
  const run = (p: Promise<unknown>): void => {
    p.then(onChange).catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }));
  };

  async function setTier(tool: string, tier: Tier): Promise<void> {
    const loosening = tier === 'SAFE';
    if (loosening) {
      const okd = await confirmAction({
        title: `Let ${tool} run without asking?`,
        body: `Only do this for read-only tools you trust. ${s.name} → ${tool} will run automatically from now on.`,
        actionLabel: 'Run without asking',
        destructive: false,
      });
      if (!okd) return;
    }
    run(
      call('mcp:update', {
        id: s.id,
        patch: { toolOverrides: { ...s.toolOverrides, [tool]: tier } },
      }),
    );
  }

  return (
    <li className="rounded-md border border-night-600 bg-night-800">
      <div className="flex items-center gap-3 p-3">
        <span
          className={clsx('size-2.5 shrink-0 rounded-pill', STATUS[s.status].dot)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-ink-100">{s.name}</h2>
            <span className="rounded-sm border border-night-600 px-1.5 text-xs text-ink-300">
              {s.trustLevel}
            </span>
          </div>
          <p className="text-sm text-ink-300">
            {STATUS[s.status].label}
            {s.status === 'ready' && ` · ${s.tools.length} tools`}
          </p>
          {s.error && <p className="mt-1 font-code text-xs break-all text-alarm-500">{s.error}</p>}
        </div>
        <Switch
          label={`Enable ${s.name}`}
          checked={s.enabled}
          onChange={(v) => run(call('mcp:update', { id: s.id, patch: { enabled: v } }))}
        />
        <Button
          variant="ghost"
          onClick={() => run(call('mcp:restart', { id: s.id }))}
          aria-label={`Retry ${s.name}`}
        >
          <RotateCw size={14} aria-hidden /> Retry
        </Button>
        <Button
          variant="ghost"
          className="text-alarm-500"
          aria-label={`Remove ${s.name}`}
          onClick={() =>
            void confirmAction({
              title: `Remove ${s.name}?`,
              body: 'Jarvis disconnects it and forgets its settings. Saved keys stay in Settings.',
              actionLabel: 'Remove connection',
              destructive: true,
            }).then((okd) => okd && run(call('mcp:remove', { id: s.id })))
          }
        >
          <Trash2 size={14} aria-hidden />
        </Button>
      </div>
      {s.tools.length > 0 && (
        <div className="border-t border-night-600">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-1 px-3 py-2 text-left text-sm text-ink-300 hover:text-ink-100"
          >
            {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{' '}
            Tools and permissions
          </button>
          {open && (
            <ul className="px-3 pb-3">
              {s.tools.map((t) => (
                <li
                  key={t.name}
                  className="flex items-start gap-3 border-t border-night-700 py-2 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-code text-sm text-ink-100">{t.name}</p>
                    <p className="text-xs text-ink-500">{t.description}</p>
                  </div>
                  <select
                    aria-label={`Permission for ${t.name}`}
                    value={t.tier}
                    onChange={(e) => void setTier(t.name, e.target.value as Tier)}
                    className={clsx(
                      'min-h-8 rounded-md border bg-night-900 px-2 text-xs',
                      t.tier === 'SAFE'
                        ? 'border-night-600'
                        : t.tier === 'CONFIRM'
                          ? 'border-lamp-400'
                          : 'border-alarm-500',
                    )}
                  >
                    <option value="SAFE">Run automatically</option>
                    <option value="CONFIRM">Ask first</option>
                    <option value="BLOCKED">Never</option>
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** Design-system.md §5.6 / App-flow.md §8. */
export function ConnectionsView(): React.JSX.Element {
  const [servers, setServers] = useState<Res<'mcp:list'>>([]);
  const [adding, setAdding] = useState(false);
  const statusVersion = useMcpStore((s) => s.status);
  const load = useCallback(() => void call('mcp:list', {}).then(setServers), []);
  useEffect(load, [load, statusVersion]);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-night-900">
      <header className="flex h-14 shrink-0 items-center border-b border-night-600 px-6">
        <h1 className="font-display text-lg font-semibold">Connections</h1>
        <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden /> Add connection
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <p className="text-sm text-ink-300">
            Connections give Jarvis tools from other apps through MCP. New tools ask before acting
            until you mark read-only ones as “Run automatically”.
          </p>
          {adding && (
            <AddConnection
              existing={servers.map((s) => s.name)}
              onDone={() => (setAdding(false), load())}
            />
          )}
          {servers.length === 0 && !adding && (
            <p className="text-ink-500">No connections yet. Add the browser first.</p>
          )}
          <ul className="flex flex-col gap-3">
            {servers.map((s) => (
              <ServerCard key={s.id} s={s} onChange={load} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
