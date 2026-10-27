import type { ReactNode } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import clsx from 'clsx';
import { Eye } from 'lucide-react';
import type { KeyHealth, PoolPhase, PoolTier } from '@shared/free-pool';
import { PROVIDER_COLORS } from './colors';

/** Building blocks shared by the AI Router tabs. */

export const TIER_NAME: Record<PoolTier, string> = {
  1: 'Brain',
  2: 'Trusted free',
  3: 'Third-party',
};

const TIER_TAG: Record<PoolTier, string> = {
  1: 'bg-accent-tint text-accent-tag-ink',
  2: 'bg-ok-tint text-ink-100',
  3: 'bg-lamp-tint text-lamp-tag-ink',
};

export function TierTag({ tier, short }: { tier: PoolTier; short?: boolean }): React.JSX.Element {
  return (
    <span className={clsx('tag whitespace-nowrap', TIER_TAG[tier])}>
      T{tier}
      {!short && ` · ${TIER_NAME[tier]}`}
    </span>
  );
}

/** Marks a control that is drawn now but wired in a later phase. */
export function PhaseTag({ phase }: { phase: PoolPhase }): React.JSX.Element {
  return (
    <span
      className="tag bg-neutral-tint whitespace-nowrap text-ink-300"
      title={`Works from Phase ${phase}`}
    >
      Phase {phase}
    </span>
  );
}

export function PreviewBanner({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-md border border-lamp-400/40 bg-lamp-tint px-4 py-3 text-sm text-lamp-tag-ink"
    >
      <Eye size={16} aria-hidden className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

const HEALTH: Record<KeyHealth, { dot: string; label: string }> = {
  healthy: { dot: 'bg-ok-400', label: 'healthy' },
  cooling: { dot: 'bg-lamp-400', label: 'cooling down' },
  issue: { dot: 'bg-alarm-500', label: 'issue' },
  unchecked: { dot: 'bg-ink-500', label: 'not checked yet' },
};

export function HealthDot({ health }: { health: KeyHealth }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-300">
      <span aria-hidden className={clsx('size-2 rounded-full', HEALTH[health].dot)} />
      {HEALTH[health].label}
    </span>
  );
}

export function ProviderDot({ id }: { id: string }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: PROVIDER_COLORS[id] ?? '#94a3b8' }}
    />
  );
}

/** 0–100 bar with the number beside it (reliability / speed / smarts). */
export function Meter({
  value,
  tone,
  label,
}: {
  value: number;
  tone: 'ok' | 'accent' | 'violet';
  label: string;
}): React.JSX.Element {
  const fill = { ok: 'bg-ok-400', accent: 'bg-accent-500', violet: 'bg-neon-magenta' }[tone];
  return (
    <div className="flex items-center gap-2" aria-label={`${label} ${value} of 100`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className={clsx('h-full rounded-full', fill)} style={{ width: `${value}%` }} />
      </div>
      <span className="w-7 text-right font-code text-xs text-ink-300 tabular-nums">
        {value || '–'}
      </span>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="hud-label text-ink-500">{label}</span>
      <span className="font-code text-xl font-semibold text-ink-100 tabular-nums">{value}</span>
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** Drawn but not selectable until this phase. */
  phase?: PoolPhase;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  livePhase = 1,
}: {
  label: string;
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (v: T) => void;
  /** Options from phases above this one are disabled. */
  livePhase?: PoolPhase;
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-md border border-line bg-surface-1 p-1"
    >
      {options.map((o) => {
        const later = (o.phase ?? 1) > livePhase;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={later}
            title={later ? `Works from Phase ${o.phase}` : undefined}
            onClick={() => onChange(o.id)}
            className={clsx(
              'rounded-sm px-3 py-1.5 font-code text-xs transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-45',
              value === o.id
                ? 'bg-accent-600 text-ink-on-accent'
                : 'text-ink-300 hover:bg-hover hover:text-ink-100',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'rounded-sm border px-2.5 py-1 font-code text-xs transition-colors duration-[120ms]',
        active
          ? 'border-accent-edge bg-accent-tint text-accent-tag-ink'
          : 'border-line text-ink-300 hover:border-line-strong hover:text-ink-100',
      )}
    >
      {children}
    </button>
  );
}

/** A compact on/off switch for table rows and setting rows; without `onChange` it is read-only. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <RadixSwitch.Root
      aria-label={label}
      checked={checked}
      disabled={disabled ?? !onChange}
      onCheckedChange={(v) => onChange?.(v)}
      className="relative h-5 w-9 shrink-0 rounded-pill bg-line-strong transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:bg-accent-600"
    >
      <RadixSwitch.Thumb className="block size-4 translate-x-0.5 rounded-pill bg-ink-on-accent shadow-sm transition-transform duration-[120ms] data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
}

/** One labelled setting row: text on the left, control on the right, phase badge if not wired. */
export function SettingRow({
  title,
  detail,
  phase,
  children,
}: {
  title: string;
  detail?: string;
  phase?: PoolPhase;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-subtle py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-100">
          {title}
          {phase && phase > 1 && <PhaseTag phase={phase} />}
        </div>
        {detail && <p className="mt-0.5 max-w-[62ch] text-sm text-ink-300">{detail}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

/** A framed block with a title row (FreeLLMAPI-style dashboard card). */
export function Panel({
  title,
  aside,
  phase,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  phase?: PoolPhase;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={clsx('card flex flex-col gap-4 p-5', className)} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-100">
          {title}
          {phase && phase > 1 && <PhaseTag phase={phase} />}
        </h2>
        {aside && <div className="text-sm text-ink-300">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function fmtAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

export function fmtIn(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}
