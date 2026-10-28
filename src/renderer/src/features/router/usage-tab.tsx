import { useState } from 'react';
import clsx from 'clsx';
import { KeyRound, Pencil, RefreshCw } from 'lucide-react';
import {
  type AllowancePeriod,
  type AllowancePeriods,
  type AllowanceSource,
  type PoolAllowance,
  type PoolSnapshot,
} from '@shared/free-pool';
import { Button } from '../../components/ui/button';
import { call } from '../../lib/api';
import type { RouterTab } from './ai-map-model';
import { RecentPanels } from './recent-panels';
import { Panel, ProviderDot, Segmented, StatTile, TabIntro, fmtTokens } from './parts';
import type { PoolActions } from './router-view';

type Row = PoolAllowance['providers'][number];
type Cell = AllowancePeriods['day'];

const PERIODS: ReadonlyArray<{ id: AllowancePeriod; label: string }> = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

const SOURCE: Record<AllowanceSource, { label: string; className: string; title: string }> = {
  yours: {
    label: 'Yours',
    className: 'bg-accent-tint text-accent-tag-ink',
    title: 'Numbers you typed from the provider’s console',
  },
  live: {
    label: 'Live',
    className: 'bg-ok-tint text-ink-100',
    title: 'Read from the provider at the last key check',
  },
  learned: {
    label: 'Learned',
    className: 'bg-ok-tint text-ink-100',
    title: 'Learned from the provider’s replies (rate-limit headers)',
  },
  published: {
    label: 'Published',
    className: 'bg-neutral-tint text-ink-300',
    title: 'From the provider’s own limits page',
  },
  estimate: {
    label: 'Estimate',
    className: 'bg-lamp-tint text-lamp-tag-ink',
    title: 'The provider shows it only after sign-in: type yours for exact numbers',
  },
  unknown: {
    label: 'Unknown',
    className: 'bg-lamp-tint text-lamp-tag-ink',
    title: 'No published or learned cap: type yours from the provider’s console',
  },
};

const fmtCount = (n: number): string => Math.round(n).toLocaleString('en-US');

/** AI Router → Usage: free tokens and requests your keys get, and what you used (2.35). */
export function UsageTab({
  snap,
  actions,
  onOpen,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
  onOpen: (tab: RouterTab) => void;
}): React.JSX.Element {
  const [period, setPeriod] = useState<AllowancePeriod>('day');
  const [checking, setChecking] = useState(false);
  const a = snap.allowance;
  const recheck = (): void => {
    setChecking(true);
    void actions.checkKeys().finally(() => setChecking(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <TabIntro
        help="router:usage"
        aside={
          <>
            <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
            <Button disabled={checking || a.providers.length === 0} onClick={recheck}>
              <RefreshCw size={14} aria-hidden className={checking ? 'animate-spin' : undefined} />
              {checking ? 'Checking…' : 'Check now'}
            </Button>
          </>
        }
      >
        How much free AI your keys get, and how much you used.
      </TabIntro>

      {a.providers.length === 0 ? (
        <Panel title="No free keys yet">
          <p className="text-sm text-ink-300">
            Add a key from a free provider (Groq, Gemini, Cerebras, OpenRouter, NVIDIA, Mistral or
            Cloudflare) and its free allowance shows up here.
          </p>
          <div>
            <Button variant="primary" onClick={() => onOpen('keys')}>
              <KeyRound size={14} aria-hidden /> Add a free key
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <TotalCard
              title="Free tokens"
              cell={a.totals.tokens[period]}
              fmt={fmtTokens}
              left={missing(a.providers, (r) => r.tokens[period])}
            />
            <TotalCard
              title="Free requests"
              cell={a.totals.requests[period]}
              fmt={fmtCount}
              left={missing(a.providers, (r) => r.requests[period])}
            />
          </div>
          <AllowanceTable rows={a.providers} period={period} actions={actions} />
        </>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Free answers today" value={fmtCount(snap.today.requests)} />
        <StatTile
          label="Success rate"
          value={snap.today.requests ? `${(snap.today.successRate * 100).toFixed(1)}%` : '—'}
          hint="after automatic retries"
        />
        <StatTile
          label="Saved vs Claude today"
          value={`$${snap.today.savedUsd.toFixed(2)}`}
          hint="what Claude would have cost"
        />
      </div>

      <RecentPanels snap={snap} />
    </div>
  );
}

/** Providers whose cap for this number isn't known (left out of the total, not counted as 0). */
function missing(rows: Row[], pick: (r: Row) => Cell): string[] {
  return rows.filter((r) => r.enabled && pick(r).limit === null).map((r) => r.label);
}

function TotalCard({
  title,
  cell,
  fmt,
  left,
}: {
  title: string;
  cell: Cell;
  fmt: (n: number) => string;
  left: string[];
}): React.JSX.Element {
  const remaining = cell.limit === null ? null : Math.max(0, cell.limit - cell.used);
  return (
    <section aria-label={title} className="card flex flex-col gap-2 p-5">
      <span className="hud-label text-ink-500">{title}</span>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-code text-3xl font-semibold text-ink-100 tabular-nums">
          {remaining === null ? fmt(cell.used) : fmt(remaining)}
        </span>
        <span className="text-sm text-ink-300">
          {remaining === null ? 'used' : `left of ${fmt(cell.limit ?? 0)}`}
        </span>
      </div>
      <Bar used={cell.used} limit={cell.limit} />
      <span className="text-xs text-ink-500">
        {fmt(cell.used)} used
        {left.length > 0 && ` · not in the total (no known cap): ${left.join(', ')}`}
      </span>
    </section>
  );
}

function Bar({ used, limit }: { used: number; limit: number | null }): React.JSX.Element {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      role="img"
      aria-label={limit ? `${Math.round(pct)}% used` : 'no known cap'}
    >
      <div
        className={clsx(
          'h-full rounded-full',
          pct >= 90 ? 'bg-alarm-500' : pct >= 70 ? 'bg-lamp-400' : 'bg-ok-400',
        )}
        style={{ width: `${Math.max(pct, used > 0 && limit ? 1 : 0)}%` }}
      />
    </div>
  );
}

function AllowanceTable({
  rows,
  period,
  actions,
}: {
  rows: Row[];
  period: AllowancePeriod;
  actions: PoolActions;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Panel title="Per provider" aside="caps add up across your keys and models">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-500">
              <th className="pb-2 font-medium">Provider</th>
              <th className="pb-2 font-medium">Tokens</th>
              <th className="pb-2 font-medium">Requests</th>
              <th className="pb-2 font-medium">Resets</th>
              <th className="pb-2" aria-label="Edit" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((r) => (
              <AllowanceRow
                key={r.id}
                row={r}
                period={period}
                editing={editing === r.id}
                onEdit={() => setEditing(editing === r.id ? null : r.id)}
                onSave={(patch) => {
                  actions.provider({ id: r.id, ...patch });
                  setEditing(null);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AllowanceRow({
  row,
  period,
  editing,
  onEdit,
  onSave,
}: {
  row: Row;
  period: AllowancePeriod;
  editing: boolean;
  onEdit: () => void;
  onSave: (patch: { tpd: number | null; rpd: number | null }) => void;
}): React.JSX.Element {
  const s = SOURCE[row.source];
  return (
    <>
      <tr className={clsx('align-top', !row.enabled && 'opacity-55')}>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2 font-medium text-ink-100">
            <ProviderDot id={row.id} />
            {row.label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
            <span className={clsx('tag', s.className)} title={s.title}>
              {s.label}
            </span>
            {row.keys} key{row.keys === 1 ? '' : 's'}
            {!row.enabled && ' · switched off'}
          </div>
        </td>
        <td className="py-3 pr-4">
          <Usage cell={row.tokens[period]} fmt={fmtTokens} row={row} />
        </td>
        <td className="py-3 pr-4">
          <Usage cell={row.requests[period]} fmt={fmtCount} row={row} />
        </td>
        <td className="py-3 pr-4 text-xs text-ink-300">
          {row.resets}
          {row.perMinute && <span className="block text-ink-500">max {row.perMinute}/min</span>}
        </td>
        <td className="py-3 text-right">
          <button
            type="button"
            aria-label={`Set ${row.label}'s free allowance`}
            aria-expanded={editing}
            onClick={onEdit}
            className="inline-flex size-8 items-center justify-center rounded-sm text-ink-500 hover:bg-hover hover:text-ink-100"
          >
            <Pencil size={14} aria-hidden />
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={5} className="pb-3">
            <OwnNumbers row={row} onSave={onSave} />
          </td>
        </tr>
      )}
    </>
  );
}

function Usage({
  cell,
  fmt,
  row,
}: {
  cell: Cell;
  fmt: (n: number) => string;
  row: Row;
}): React.JSX.Element {
  if (cell.limit === null)
    return (
      <div className="flex flex-col gap-1">
        <span className="font-code text-ink-100 tabular-nums">{fmt(cell.used)} used</span>
        <span className="text-xs text-ink-500">
          {row.unlimited ? 'no daily cap' : 'cap not known'}
        </span>
      </div>
    );
  const left = Math.max(0, cell.limit - cell.used);
  return (
    <div className="flex min-w-36 flex-col gap-1">
      <span className="font-code text-ink-100 tabular-nums">
        {fmt(left)} <span className="text-ink-500">left of {fmt(cell.limit)}</span>
        {row.partial && (
          <span
            className="text-lamp-400"
            title="Some models have no known cap: counted without them"
          >
            {' '}
            +
          </span>
        )}
      </span>
      <Bar used={cell.used} limit={cell.limit} />
      <span className="text-xs text-ink-500">{fmt(cell.used)} used</span>
    </div>
  );
}

/** Sir's daily numbers from the provider's console: they replace Jarvis's. */
function OwnNumbers({
  row,
  onSave,
}: {
  row: Row;
  onSave: (patch: { tpd: number | null; rpd: number | null }) => void;
}): React.JSX.Element {
  const [tpd, setTpd] = useState(row.yours.tpd ? String(row.yours.tpd) : '');
  const [rpd, setRpd] = useState(row.yours.rpd ? String(row.yours.rpd) : '');
  const [error, setError] = useState('');
  return (
    <form
      aria-label={`${row.label} free allowance`}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const t = parseAmount(tpd, 1e12);
        const r = parseAmount(rpd, 1e9);
        if (t === undefined || r === undefined) {
          setError('Type a whole number like 500000, 500K or 1.5M, or leave the box empty.');
          return;
        }
        onSave({ tpd: t, rpd: r });
      }}
    >
      <p className="text-sm text-ink-300">
        {row.note}{' '}
        <button
          type="button"
          className="text-accent-300 underline underline-offset-2"
          onClick={() => void call('app:openExternal', { url: row.docsUrl })}
        >
          Open the limits page
        </button>
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-100">
          Free tokens a day
          <input
            inputMode="numeric"
            value={tpd}
            onChange={(e) => setTpd(e.target.value)}
            placeholder="Jarvis's number"
            className="min-h-9 w-44 rounded-sm border border-line bg-surface-1 px-2 font-code text-ink-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-100">
          Free requests a day
          <input
            inputMode="numeric"
            value={rpd}
            onChange={(e) => setRpd(e.target.value)}
            placeholder="Jarvis's number"
            className="min-h-9 w-44 rounded-sm border border-line bg-surface-1 px-2 font-code text-ink-100"
          />
        </label>
        <Button type="submit" variant="primary">
          Save
        </Button>
        {(row.yours.tpd || row.yours.rpd) && (
          <Button onClick={() => onSave({ tpd: null, rpd: null })}>
            Use Jarvis&apos;s numbers
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-alarm-500">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-500">
        For all your {row.label} keys together. Leave a box empty to keep Jarvis&apos;s number.
      </p>
    </form>
  );
}

const SUFFIX: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9 };

/** "500,000", "500K", "1.5M" → a whole number; empty → null (Jarvis's number); else undefined. */
export function parseAmount(v: string, max: number): number | null | undefined {
  const t = v.replaceAll(/[,_\s]/g, '').toLowerCase();
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)([kmb]?)$/.exec(t);
  if (!m) return undefined;
  const n = Math.round(Number(m[1]) * (SUFFIX[m[2] ?? ''] ?? 1));
  return n > 0 && n <= max ? n : undefined;
}
