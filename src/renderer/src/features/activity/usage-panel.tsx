import { useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { call } from '../../lib/api';

type Range = 'day' | 'month';
type By = 'model' | 'purpose' | 'day';

const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** Activity → Usage: today/month spend against the budget, and where the money went. */
export function UsagePanel(): React.JSX.Element {
  const [range, setRange] = useState<Range>('month');
  const [by, setBy] = useState<By>('model');
  const [summary, setSummary] = useState<Res<'usage:summary'> | null>(null);
  const [rows, setRows] = useState<Res<'usage:breakdown'>>([]);

  useEffect(() => {
    void call('usage:summary', { range }).then(setSummary);
    void call('usage:breakdown', { range, by }).then(setRows);
  }, [range, by]);

  const max = Math.max(...rows.map((r) => r.costUsd), 0.000001);
  const pct =
    summary && summary.budget > 0 ? Math.min(100, (summary.costUsd / summary.budget) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <Select<Range>
          label="Period"
          value={range}
          options={{ day: 'Today', month: 'This month' }}
          onChange={setRange}
        />
        <Select<By>
          label="Group by"
          value={by}
          options={{ model: 'Model', purpose: 'Purpose', day: 'Day' }}
          onChange={setBy}
        />
      </div>

      {summary && (
        <section aria-label="Spend" className="card p-5">
          <p className="text-sm text-ink-300">
            {range === 'day' ? 'API spend today' : 'API spend this month'}
          </p>
          <p className="text-2xl font-semibold text-ink-100 tabular">
            {usd(summary.costUsd)}
            {summary.budget > 0 && (
              <span className="ml-2 text-base text-ink-500">of {usd(summary.budget)}</span>
            )}
          </p>
          {summary.budget > 0 && (
            <div
              className="mt-3 h-2 rounded-pill bg-hover"
              role="meter"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Budget used"
            >
              <div
                className={`h-2 rounded-pill ${pct >= 90 ? 'bg-alarm-fill' : pct >= 70 ? 'bg-lamp-400' : 'bg-accent-300'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          {summary.subscriptionCostUsd > 0 && (
            <p className="mt-2 text-sm text-ink-300 tabular">
              Plus {usd(summary.subscriptionCostUsd)} API-equivalent through your Claude
              subscription (not charged, not counted against the budget).
            </p>
          )}
          <p className="mt-2 text-xs text-ink-500 tabular">
            {summary.tokens.toLocaleString()} tokens
          </p>
        </section>
      )}

      {summary?.plan && <PlanGauges plan={summary.plan} />}

      <table className="w-full text-left text-sm tabular">
        <thead className="text-ink-500">
          <tr>
            <th className="py-1 pr-3 font-medium">
              {by === 'day' ? 'Day' : by === 'model' ? 'Model' : 'Purpose'}
            </th>
            <th className="py-1 pr-3 font-medium">Calls</th>
            <th className="py-1 pr-3 font-medium">Tokens</th>
            <th className="py-1 font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-ink-500">
                No usage yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-1.5 pr-3 text-ink-100">{r.key}</td>
              <td className="py-1.5 pr-3 text-ink-300">{r.calls}</td>
              <td className="py-1.5 pr-3 text-ink-300">{r.tokens.toLocaleString()}</td>
              <td className="py-1.5">
                <div className="flex items-center gap-2">
                  <div
                    className="h-1.5 rounded-pill bg-accent-300"
                    style={{ width: `${(r.costUsd / max) * 120}px` }}
                    aria-hidden
                  />
                  <span className="text-ink-100">{usd(r.costUsd)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Plan = NonNullable<Res<'usage:summary'>['plan']>;

const resetLabel = (ms: number | null): string =>
  ms === null
    ? ''
    : `resets ${new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;

/** Claude plan windows as Claude Code last reported them (idea from ethanplusai/jarvis's Usage tab). */
function PlanGauges({ plan }: { plan: Plan }): React.JSX.Element {
  const windows = [
    { label: '5-hour window', w: plan.fiveHour },
    { label: 'This week', w: plan.sevenDay },
  ].filter((x) => x.w !== null);
  return (
    <section aria-label="Claude plan usage" className="card p-5">
      <p className="text-sm text-ink-300">Claude plan usage</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {windows.map(({ label, w }) => {
          const pct = Math.round(w?.usedPercent ?? 0);
          return (
            <div key={label}>
              <p className="flex items-baseline justify-between text-sm">
                <span className="text-ink-100">{label}</span>
                <span className="text-xl font-semibold text-ink-100 tabular">{pct}%</span>
              </p>
              <div
                className="mt-2 h-2 rounded-pill bg-hover"
                role="meter"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${label} used`}
              >
                <div
                  className={`h-2 rounded-pill ${pct >= 90 ? 'bg-alarm-fill' : pct >= 70 ? 'bg-lamp-400' : 'bg-accent-300'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-ink-500 tabular">{resetLabel(w?.resetsAt ?? null)}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-500">
        As Claude Code reported at {new Date(plan.updatedAt).toLocaleTimeString()}. Updates after
        each reply through the subscription.
      </p>
    </section>
  );
}

function Select<T extends string>(p: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange(v: T): void;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-300">
      {p.label}
      <select
        value={p.value}
        onChange={(e) => p.onChange(e.target.value as T)}
        className="min-h-8 rounded-md border border-line bg-surface-2 px-2 text-ink-100"
      >
        {(Object.keys(p.options) as T[]).map((k) => (
          <option key={k} value={k}>
            {p.options[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
