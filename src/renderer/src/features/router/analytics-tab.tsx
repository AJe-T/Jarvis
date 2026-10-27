import { useEffect, useState } from 'react';
import { ANALYTICS_RANGES, type AnalyticsRange, type PoolAnalytics } from '@shared/free-pool';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { FilterChip, Panel, ProviderDot, StatTile, fmtTokens } from './parts';

const pct = (x: number): string => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`;
const secs = (ms: number): string => (ms ? `${(ms / 1000).toFixed(1)} s` : '—');

/**
 * Analytics (Phase 4): how the free pool did over time, per provider and per model, and what is
 * left today. Read from the request log (who was asked and how it went, never the text).
 */
export function AnalyticsTab(): React.JSX.Element {
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [data, setData] = useState<PoolAnalytics | null>(null);
  const toast = useUiStore((s) => s.toast);
  useEffect(() => {
    let live = true;
    void call('pool:analytics', { range })
      .then((d) => live && setData(d))
      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }));
    return () => {
      live = false;
    };
  }, [range, toast]);

  const t = data?.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time range">
        {ANALYTICS_RANGES.map((r) => (
          <FilterChip key={r} active={range === r} onClick={() => setRange(r)}>
            {r === '24h' ? 'Last 24 hours' : `Last ${r.replace('d', ' days')}`}
          </FilterChip>
        ))}
      </div>
      {!data || !t ? (
        <span className="skeleton block h-40 w-full" aria-hidden />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Requests" value={t.requests.toLocaleString()} hint="every attempt" />
            <StatTile label="Success rate" value={pct(t.successRate)} />
            <StatTile label="Tokens in" value={fmtTokens(t.tokensIn)} />
            <StatTile label="Tokens out" value={fmtTokens(t.tokensOut)} />
            <StatTile label="Average time" value={secs(t.avgMs)} hint="answers that worked" />
            <StatTile label="Slowest 5%" value={secs(t.p95Ms)} hint="p95" />
            <StatTile label="Models used" value={String(data.models.length)} />
            <StatTile label="Saved vs Claude" value={`$${t.savedUsd.toFixed(2)}`} />
          </div>
          {t.requests === 0 && (
            <p className="text-sm text-ink-300">
              Nothing in this range yet. Numbers appear once free AIs start answering (delegations,
              the front door, Compare AIs, a model test).
            </p>
          )}
          <Panel title="Requests over time">
            <LineChart
              label="Answered and failed requests"
              labels={data.buckets.map((b) => b.label)}
              series={[
                {
                  values: data.buckets.map((b) => b.ok),
                  stroke: 'var(--accent-500)',
                  name: 'Answered',
                },
                {
                  values: data.buckets.map((b) => b.fail),
                  stroke: 'var(--alarm-500)',
                  name: 'Failed',
                },
              ]}
            />
          </Panel>
          <Panel title="Tokens over time">
            <LineChart
              label="Tokens used by answers that worked"
              labels={data.buckets.map((b) => b.label)}
              series={[
                {
                  values: data.buckets.map((b) => b.tokens),
                  stroke: 'var(--neon-magenta)',
                  name: 'Tokens',
                },
              ]}
              format={fmtTokens}
            />
          </Panel>
          <Panel title="Per provider and what's left today">
            <Table
              caption="Requests, success, speed and today's outlook per provider"
              head={['Provider', 'Requests', 'Success', 'Avg time', 'Today', 'Outlook']}
              rows={data.providers.map((p) => [
                <span key="n" className="flex items-center gap-2 text-ink-100">
                  <ProviderDot id={p.id} />
                  {p.label}
                </span>,
                p.requests.toLocaleString(),
                p.requests ? pct(p.successRate) : '—',
                secs(p.avgMs),
                p.usedToday === null ? '—' : <UsedBar key="u" used={p.usedToday} />,
                <span key="o" className="font-sans text-ink-300">
                  {p.outlook}
                </span>,
              ])}
            />
            <p className="text-xs text-ink-500">
              Outlook: today&apos;s use of each provider&apos;s known daily cap and the pace since
              the caps reset at 00:00 UTC. Providers that publish no cap are learned from replies.
            </p>
          </Panel>
          <Panel title="Busiest models">
            <Table
              caption="Requests, success and tokens per model"
              head={['Model', 'Requests', 'Success', 'Tokens']}
              rows={data.models.map((m) => [
                <span key="m" className="font-code text-xs text-ink-100">
                  {m.id}
                </span>,
                m.requests.toLocaleString(),
                pct(m.successRate),
                fmtTokens(m.tokens),
              ])}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

function UsedBar({ used }: { used: number }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span
          className={used > 0.85 ? 'block h-full bg-alarm-500' : 'block h-full bg-accent-500'}
          style={{ width: `${Math.round(used * 100)}%` }}
        />
      </span>
      {Math.round(used * 100)}%
    </span>
  );
}

function Table({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: React.ReactNode[][];
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-500">
            {head.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={
                  i === 0 || i === head.length - 1
                    ? 'py-2 font-medium'
                    : 'py-2 pr-4 text-right font-medium'
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="py-4 text-center text-ink-500">
                Nothing yet.
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line-subtle last:border-0">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={
                    j === 0 || j === r.length - 1
                      ? 'py-2'
                      : 'py-2 pr-4 text-right font-code text-ink-300 tabular-nums'
                  }
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A small dependency-free line chart (no chart library in Jarvis). */
function LineChart({
  label,
  labels,
  series,
  format = (n: number): string => String(Math.round(n)),
}: {
  label: string;
  labels: string[];
  series: Array<{ values: number[]; stroke: string; name: string }>;
  format?: (n: number) => string;
}): React.JSX.Element {
  const W = 900;
  const H = 190;
  const n = Math.max(labels.length, 2);
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const x = (i: number): number => 50 + (i / (n - 1)) * (W - 64);
  const y = (v: number): number => H - 24 - (v / max) * (H - 40);
  // At most ~10 labels along the bottom.
  const every = Math.max(1, Math.ceil(labels.length / 10));
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={50}
              x2={W - 10}
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="var(--line-subtle)"
              strokeDasharray="3 4"
            />
            {/* Small counts: no middle label that repeats a neighbour ("0, 1, 1"). */}
            {(f !== 0.5 || ![format(0), format(max)].includes(format(max / 2))) && (
              <text x={44} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="var(--ink-500)">
                {format(max * f)}
              </text>
            )}
          </g>
        ))}
        {labels.map((d, i) =>
          i % every === 0 || i === labels.length - 1 ? (
            <text
              key={`${d}-${i}`}
              x={x(i)}
              y={H - 6}
              // The first and last labels stay inside the chart.
              textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
              fontSize="11"
              fill="var(--ink-500)"
            >
              {d}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={s.stroke}
              strokeWidth={2}
              strokeLinejoin="round"
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            />
            {s.values.map((v, i) =>
              v > 0 ? (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.stroke}>
                  <title>{`${labels[i]}: ${format(v)}`}</title>
                </circle>
              ) : null,
            )}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-ink-300">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4" style={{ background: s.stroke }} />
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
