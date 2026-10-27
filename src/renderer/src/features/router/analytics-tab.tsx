import { useState } from 'react';
import type { PoolSnapshot } from '@shared/free-pool';
import { FilterChip, Panel, PhaseTag, ProviderDot, StatTile, fmtTokens } from './parts';

const RANGES = ['24h', '7d', '30d', '90d'] as const;

// Sample series for the preview (7 days); Phase 4 reads the request log instead.
const SUCCESS = [140, 210, 260, 190, 230, 250, 184];
const FAILURES = [22, 41, 18, 12, 15, 9, 7];
const TOKENS = [0.31, 0.52, 0.66, 0.44, 0.58, 0.61, 0.41];
const DAYS = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'];

const PER_PROVIDER = [
  {
    id: 'groq',
    requests: 612,
    success: 0.91,
    ms: 640,
    outlook: 'runs out around 19:40 at this pace',
  },
  { id: 'cerebras', requests: 344, success: 0.97, ms: 520, outlook: 'plenty left today' },
  { id: 'gemini', requests: 298, success: 0.98, ms: 1850, outlook: 'about 60% left today' },
  { id: 'openrouter', requests: 121, success: 0.88, ms: 2400, outlook: 'runs out around 22:10' },
  { id: 'cloudflare', requests: 76, success: 0.95, ms: 1300, outlook: 'plenty left today' },
];

/** Analytics (Phase 4): how the pool is doing over time, per provider, and what's left. */
export function AnalyticsTab({ snap }: { snap: PoolSnapshot }): React.JSX.Element {
  const [range, setRange] = useState<(typeof RANGES)[number]>('7d');
  const label = (id: string): string => snap.providers.find((p) => p.id === id)?.label ?? id;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <FilterChip key={r} active={range === r} onClick={() => setRange(r)}>
            {r}
          </FilterChip>
        ))}
        <span className="ml-auto">
          <PhaseTag phase={4} />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Requests" value="1,733" />
        <StatTile label="Success rate" value="92.6%" />
        <StatTile label="Tokens in" value="3.1M" />
        <StatTile label="Tokens out" value="412K" />
        <StatTile label="Average time" value="1.4 s" />
        <StatTile label="Slowest 5%" value="6.8 s" hint="p95" />
        <StatTile label="First word after" value="0.6 s" hint="time to first token" />
        <StatTile label="Saved vs Claude" value="$11.40" />
      </div>
      <Panel title="Requests over time" phase={4}>
        <LineChart
          label="Successful and failed requests per day"
          series={[
            { values: SUCCESS, stroke: 'var(--accent-500)', name: 'Answered' },
            { values: FAILURES, stroke: 'var(--alarm-500)', name: 'Failed' },
          ]}
        />
      </Panel>
      <Panel title="Tokens over time" phase={4}>
        <LineChart
          label="Million tokens per day"
          series={[{ values: TOKENS, stroke: 'var(--neon-magenta)', name: 'Million tokens' }]}
        />
      </Panel>
      <Panel title="Per provider and what's left today" phase={4}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Requests, success, speed and outlook per provider</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-500">
                <th scope="col" className="py-2 font-medium">
                  Provider
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Requests
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Success
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Avg time
                </th>
                <th scope="col" className="py-2 pl-6 font-medium">
                  Outlook
                </th>
              </tr>
            </thead>
            <tbody>
              {PER_PROVIDER.map((p) => (
                <tr key={p.id} className="border-b border-line-subtle last:border-0">
                  <td className="py-2">
                    <span className="flex items-center gap-2 text-ink-100">
                      <ProviderDot id={p.id} />
                      {label(p.id)}
                    </span>
                  </td>
                  <td className="py-2 text-right font-code text-ink-300 tabular-nums">
                    {p.requests}
                  </td>
                  <td className="py-2 text-right font-code text-ink-300 tabular-nums">
                    {(p.success * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 text-right font-code text-ink-300 tabular-nums">
                    {(p.ms / 1000).toFixed(1)} s
                  </td>
                  <td className="py-2 pl-6 text-ink-300">{p.outlook}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-500">
          Sample numbers. Today so far: {fmtTokens(snap.today.tokens)} tokens.
        </p>
      </Panel>
    </div>
  );
}

/** A small dependency-free line chart (no chart library in Jarvis). */
function LineChart({
  label,
  series,
}: {
  label: string;
  series: Array<{ values: number[]; stroke: string; name: string }>;
}): React.JSX.Element {
  const W = 900;
  const H = 170;
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const x = (i: number): number => 30 + (i / (DAYS.length - 1)) * (W - 40);
  const y = (v: number): number => H - 20 - (v / max) * (H - 30);
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={30}
            x2={W - 10}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="var(--line-subtle)"
            strokeDasharray="3 4"
          />
        ))}
        {DAYS.map((d, i) => (
          <text key={d} x={x(i)} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--ink-500)">
            {d}
          </text>
        ))}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
          />
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
