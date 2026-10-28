import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { Res } from '@shared/ipc-contract';
import { IconButton } from '../../components/ui/button';
import { PageBody, PageHeader } from '../../components/ui/page';
import { call, cleanError } from '../../lib/api';
import { StatTile } from '../router/parts';

type Run = Res<'forge:runs'>[number];

/** Refresh while a run is working (Forge writes its run file at each step). */
const POLL_MS = 5_000;
const FINISHED = new Set(['passed', 'failed', 'cancelled']);

const STATE_TONE: Record<string, string> = {
  passed: 'text-ok-400',
  failed: 'text-alarm-500',
  cancelled: 'text-ink-500',
};

const usd = (n: number): string => `$${n.toFixed(2)}`;

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function minutes(r: Run): string {
  const m = Math.round(((r.endedAt ?? Date.now()) - r.startedAt) / 60_000);
  return m < 1 ? '<1 min' : `${m} min`;
}

/** "Shipped v2.40.0", "Shipping…", or what the run ended as. */
function status(r: Run): { text: string; tone: string } {
  if (r.ship?.state === 'shipped')
    return { text: `shipped v${r.ship.version ?? ''}`, tone: 'text-ok-400' };
  if (r.ship?.state === 'running') return { text: 'shipping', tone: 'text-accent-300' };
  if (r.ship) return { text: `ship ${r.ship.state}`, tone: 'text-alarm-500' };
  return {
    text: r.state,
    tone: STATE_TONE[r.state] ?? 'text-accent-300',
  };
}

/** Totals over the runs on the page: Claude spend this month and overall, versions shipped, free share. */
function totals(runs: Run[]): { month: number; all: number; shipped: number; free: string } {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const free = runs.reduce((n, r) => n + r.freeEdits, 0);
  const edits = free + runs.reduce((n, r) => n + r.claudeEdits, 0);
  return {
    month: runs.filter((r) => r.startedAt >= start.getTime()).reduce((n, r) => n + r.costUsd, 0),
    all: runs.reduce((n, r) => n + r.costUsd, 0),
    shipped: runs.filter((r) => r.ship?.state === 'shipped').length,
    free: edits ? `${Math.round((free / edits) * 100)}%` : '—',
  };
}

function Details({ run }: { run: Run }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3 text-sm">
      {run.error && <p className="text-alarm-500">Why: {run.error}</p>}
      {run.checks.length > 0 && (
        <ul aria-label="Checks" className="flex flex-wrap gap-1.5">
          {run.checks.map((c) => (
            <li
              key={c.id}
              className={clsx(
                'rounded-sm border px-1.5 py-0.5 font-code text-xs',
                c.ok ? 'border-line text-ok-400' : 'border-alarm-500 text-alarm-500',
              )}
            >
              {c.ok ? 'PASS' : 'FAIL'} {c.id}
            </li>
          ))}
        </ul>
      )}
      {run.study && (
        <p className="text-ink-300">
          Studied first: {run.study.source}
          {run.study.notes ? ` · notes: ${run.study.notes}` : ''}
          {run.study.blocks + run.study.warns > 0
            ? ` · no-copy check: ${run.study.blocks} blocked, ${run.study.warns} warnings`
            : ''}
          {run.study.partial ? ' (partial check: the repository was too big)' : ''}
        </p>
      )}
      {run.ship && (
        <p className="text-ink-300">
          Shipping: {run.ship.done.join(', ') || 'nothing done yet'}
          {run.ship.installer ? (
            <span className="block font-code text-xs text-ink-100 select-all">
              {run.ship.installer}
            </span>
          ) : null}
          {run.ship.error ? <span className="block text-alarm-500">{run.ship.error}</span> : null}
        </p>
      )}
      {run.summary && (
        <div>
          <span className="hud-label text-ink-500">Claude&apos;s summary (its own words)</span>
          {/* Plain text: the summary is Claude's, partly from the repository it read. */}
          <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap text-ink-300">
            {run.summary}
          </p>
        </div>
      )}
      {run.log.length > 0 && (
        <div>
          <span className="hud-label text-ink-500">Last steps</span>
          <ul className="mt-1 list-inside list-disc text-xs text-ink-500">
            {run.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {run.branch && <p className="font-code text-xs text-ink-500">Branch {run.branch}</p>}
    </div>
  );
}

function RunRow({ run }: { run: Run }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const s = status(run);
  return (
    <li className="card flex flex-col gap-2 p-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-ink-100">
            {run.kind === 'tool' ? `Tool "${run.tool ?? ''}": ` : ''}
            {run.goal}
          </span>
          <span className="mt-1 block text-xs text-ink-500">
            {when(run.startedAt)} · {minutes(run)} · Claude {usd(run.costUsd)}
            {run.freeEdits + run.claudeEdits > 0
              ? ` · free AIs did ${run.freeEdits} of ${run.freeEdits + run.claudeEdits} edits`
              : ''}
            {run.study ? ' · studied first' : ''}
          </span>
        </span>
        <span role="status" className={clsx('shrink-0 font-code text-xs uppercase', s.tone)}>
          {s.text}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={clsx('shrink-0 text-ink-500 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <Details run={run} />}
    </li>
  );
}

/** Forge F7: every Forge run on this PC, what it cost, and what shipped (docs/Forge.md). */
export function ForgeView(): React.JSX.Element {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    call('forge:runs', {})
      .then((r) => {
        setRuns(r);
        setError(null);
      })
      .catch((err: unknown) => setError(cleanError(err)));
  }, []);
  useEffect(load, [load]);
  const working = runs?.some((r) => !FINISHED.has(r.state) || r.ship?.state === 'running');
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [working, load]);
  const t = totals(runs ?? []);
  return (
    <>
      <PageHeader title="Forge" help="forge">
        <IconButton label="Refresh" onClick={load}>
          <RefreshCw size={16} aria-hidden />
        </IconButton>
      </PageHeader>
      <PageBody className="flex flex-col gap-4">
        <p className="text-sm text-ink-300">
          Jarvis building changes and tools for itself. Say &quot;Jarvis, learn to …&quot; to start
          one; Jarvis asks before it builds, before it ships, and never installs by itself.
        </p>
        <section aria-label="Totals" className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile label="Claude this month" value={usd(t.month)} />
          <StatTile label="Claude in all" value={usd(t.all)} hint="estimates from Claude Code" />
          <StatTile label="Versions shipped" value={String(t.shipped)} />
          <StatTile label="Edits done free" value={t.free} />
        </section>
        {error && <p className="text-sm text-alarm-500">{error}</p>}
        {runs === null && !error && <span className="skeleton block h-24 w-full" aria-hidden />}
        {runs?.length === 0 && (
          <p className="text-sm text-ink-500">
            No Forge runs yet. Set it up once with &quot;use git@github.com:&lt;you&gt;/Jarvis.git
            for Forge&quot;.
          </p>
        )}
        {runs && runs.length > 0 && (
          <ul aria-label="Forge runs" className="flex flex-col gap-2">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
