import clsx from 'clsx';

/** A usage bar turns yellow at 80 % and red at 100 %; a level bar (`low`, e.g. battery) when it runs low. */
export function Meter({ percent, low }: { percent: number; low?: boolean }): React.JSX.Element {
  const tone = low
    ? percent <= 20
      ? 'bg-alarm-fill'
      : percent <= 40
        ? 'bg-lamp-400'
        : 'bg-ok-400'
    : percent >= 100
      ? 'bg-alarm-fill'
      : percent >= 80
        ? 'bg-lamp-400'
        : 'bg-accent-500';
  return (
    <span className="mt-1.5 block h-1 overflow-hidden rounded-pill bg-surface-2" aria-hidden>
      <span
        className={clsx('block h-full rounded-pill transition-[width] duration-500', tone)}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </span>
  );
}

export function StatGrid({
  stats,
}: {
  stats: Array<{
    label: string;
    value: string;
    hint?: string | undefined;
    percent?: number | undefined;
    /** The bar shows a level where low is bad (battery), not usage where high is bad. */
    low?: boolean;
  }>;
}): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="inset px-3 py-2.5">
          <dt className="hud-label">{s.label}</dt>
          <dd className="mt-0.5 font-code text-lg text-ink-100 tabular">{s.value}</dd>
          {s.hint && <dd className="text-xs text-ink-500">{s.hint}</dd>}
          {s.percent !== undefined && <Meter percent={s.percent} low={s.low ?? false} />}
        </div>
      ))}
    </dl>
  );
}
