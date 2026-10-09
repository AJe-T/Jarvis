import { useState } from 'react';
import { CalendarDays, Clock, Flag, Hash, Plus, Repeat } from 'lucide-react';
import clsx from 'clsx';
import type { Recurrence } from '@shared/planner';
import { describeRecurrence, parseLocal } from '@shared/planner-time';
import { parseQuickAdd, type QuickAdd } from '@shared/quick-add';
import { dayLabel } from './task-filters';

/** Shared bits of the Tasks and Calendar views: priority colours, repeat picker, quick-add box. */

export const PRIORITY: Record<number, { label: string; className: string; ring: string }> = {
  1: { label: 'P1 · Urgent', className: 'text-alarm-500', ring: 'border-alarm-500 bg-alarm-tint' },
  2: { label: 'P2 · High', className: 'text-lamp-400', ring: 'border-lamp-400 bg-lamp-tint' },
  3: {
    label: 'P3 · Medium',
    className: 'text-accent-500',
    ring: 'border-accent-500 bg-accent-tint',
  },
  4: { label: 'P4 · None', className: 'text-ink-500', ring: 'border-line-strong' },
};

export const selectClass =
  'h-8 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100 focus-visible:border-accent-edge';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
type Preset =
  'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom';

function presetOf(r: Recurrence | null): Preset {
  if (!r) return 'none';
  if (r.until || r.count) return 'custom';
  const days = r.byDay ?? [];
  if (
    r.freq === 'weekly' &&
    days.length &&
    [...days].sort().join() === '1,2,3,4,5' &&
    r.interval === 1
  )
    return 'weekdays';
  if (days.length > 1) return 'custom';
  if (r.interval === 1) return r.freq;
  if (r.freq === 'weekly' && r.interval === 2) return 'biweekly';
  return 'custom';
}

/** None / daily / weekdays / weekly / every 2 weeks / monthly / yearly / custom (interval, days, end). */
export function RepeatPicker({
  value,
  onChange,
  startDate,
}: {
  value: Recurrence | null;
  onChange: (r: Recurrence | null) => void;
  /** The weekday new weekly rules start on. */
  startDate: string | null;
}): React.JSX.Element {
  const [custom, setCustom] = useState(presetOf(value) === 'custom');
  const preset = custom ? 'custom' : presetOf(value);
  const dow = startDate ? parseLocal(startDate).getDay() : new Date().getDay();
  const pick = (p: Preset): void => {
    setCustom(p === 'custom');
    const map: Record<Preset, Recurrence | null> = {
      none: null,
      daily: { freq: 'daily', interval: 1 },
      weekdays: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] },
      weekly: { freq: 'weekly', interval: 1 },
      biweekly: { freq: 'weekly', interval: 2 },
      monthly: { freq: 'monthly', interval: 1 },
      yearly: { freq: 'yearly', interval: 1 },
      custom: value ?? { freq: 'weekly', interval: 1, byDay: [dow] },
    };
    onChange(map[p]);
  };
  const r = value;
  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Repeat"
        className={selectClass}
        value={preset}
        onChange={(e) => pick(e.target.value as Preset)}
      >
        <option value="none">Does not repeat</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Every weekday (Mon–Fri)</option>
        <option value="weekly">Every week</option>
        <option value="biweekly">Every 2 weeks</option>
        <option value="monthly">Every month</option>
        <option value="yearly">Every year</option>
        <option value="custom">Custom…</option>
      </select>
      {preset === 'custom' && r && (
        <div className="inset flex flex-col gap-2 p-2 text-sm text-ink-300">
          <div className="flex items-center gap-2">
            Every
            <input
              type="number"
              min={1}
              max={366}
              aria-label="Interval"
              value={r.interval}
              onChange={(e) =>
                onChange({
                  ...r,
                  interval: Math.max(1, Math.min(366, Number(e.target.value) || 1)),
                })
              }
              className={clsx(selectClass, 'w-16')}
            />
            <select
              aria-label="Unit"
              className={selectClass}
              value={r.freq}
              onChange={(e) => {
                const freq = e.target.value as Recurrence['freq'];
                const { byDay: _b, ...rest } = r;
                onChange(freq === 'weekly' ? { ...rest, freq, byDay: [dow] } : { ...rest, freq });
              }}
            >
              <option value="daily">days</option>
              <option value="weekly">weeks</option>
              <option value="monthly">months</option>
              <option value="yearly">years</option>
            </select>
          </div>
          {r.freq === 'weekly' && (
            <div className="flex gap-1" role="group" aria-label="On days">
              {WEEKDAYS.map((d, i) => {
                const on = (r.byDay ?? [dow]).includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    aria-label={
                      [
                        'Sunday',
                        'Monday',
                        'Tuesday',
                        'Wednesday',
                        'Thursday',
                        'Friday',
                        'Saturday',
                      ][i]
                    }
                    onClick={() => {
                      const cur = r.byDay ?? [dow];
                      const next = on ? cur.filter((x) => x !== i) : [...cur, i];
                      onChange({ ...r, byDay: next.length ? next : [i] });
                    }}
                    className={clsx(
                      'size-7 rounded-pill text-xs font-medium transition-colors',
                      on
                        ? 'bg-accent-600 text-ink-on-accent'
                        : 'bg-surface-1 text-ink-300 hover:bg-hover',
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            Ends
            <select
              aria-label="Ends"
              className={selectClass}
              value={r.until ? 'until' : r.count ? 'count' : 'never'}
              onChange={(e) => {
                const { until: _u, count: _c, ...rest } = r;
                if (e.target.value === 'until')
                  onChange({ ...rest, until: startDate ?? new Date().toISOString().slice(0, 10) });
                else if (e.target.value === 'count') onChange({ ...rest, count: 10 });
                else onChange(rest);
              }}
            >
              <option value="never">never</option>
              <option value="until">on a date</option>
              <option value="count">after N times</option>
            </select>
            {r.until && (
              <input
                type="date"
                aria-label="End date"
                value={r.until}
                onChange={(e) => e.target.value && onChange({ ...r, until: e.target.value })}
                className={selectClass}
              />
            )}
            {r.count !== undefined && (
              <input
                type="number"
                min={1}
                max={1000}
                aria-label="Times"
                value={r.count}
                onChange={(e) =>
                  onChange({
                    ...r,
                    count: Math.max(1, Math.min(1000, Number(e.target.value) || 1)),
                  })
                }
                className={clsx(selectClass, 'w-20')}
              />
            )}
          </div>
          <p className="text-xs text-ink-500">{describeRecurrence(r)}</p>
        </div>
      )}
    </div>
  );
}

function Chip({
  icon: Icon,
  children,
}: {
  icon: typeof Clock;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-accent-tint px-2 py-0.5 text-xs text-accent-tag-ink">
      <Icon size={11} aria-hidden />
      {children}
    </span>
  );
}

/** What the quick-add box understood, as chips under it (Todoist-style live parsing). */
export function ParsedChips({
  q,
  today,
}: {
  q: QuickAdd;
  today: string;
}): React.JSX.Element | null {
  const chips = [
    q.date && (
      <Chip key="d" icon={CalendarDays}>
        {dayLabel(q.date, today)}
      </Chip>
    ),
    q.time && (
      <Chip key="t" icon={Clock}>
        {q.endTime ? `${q.time}–${q.endTime}` : q.time}
        {q.durationMin && !q.endTime ? ` · ${q.durationMin}m` : ''}
      </Chip>
    ),
    q.recurrence && (
      <Chip key="r" icon={Repeat}>
        {describeRecurrence(q.recurrence)}
      </Chip>
    ),
    q.priority && (
      <Chip key="p" icon={Flag}>
        P{q.priority}
      </Chip>
    ),
    ...q.hashtags.map((h) => (
      <Chip key={`h${h}`} icon={Hash}>
        {h}
      </Chip>
    )),
  ].filter(Boolean);
  return chips.length ? <div className="flex flex-wrap gap-1.5">{chips}</div> : null;
}

/** One line that understands "tomorrow 5pm", "every monday", "#list", "!1". */
export function QuickAddInput({
  placeholder,
  onSubmit,
  today,
  inputRef,
}: {
  placeholder: string;
  onSubmit: (text: string, parsed: QuickAdd) => void;
  today: string;
  inputRef?: React.Ref<HTMLInputElement>;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseQuickAdd(text) : null;
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed?.title) return;
        onSubmit(text, parsed);
        setText('');
      }}
    >
      <div className="flex h-10 items-center gap-2 rounded-md border border-line bg-surface-1 px-3 transition-colors focus-within:border-accent-edge focus-within:shadow-[0_0_0_3px_var(--accent-tint)]">
        <Plus size={16} aria-hidden className="text-accent-500" />
        <input
          ref={inputRef}
          aria-label={placeholder}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setText('')}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-100 outline-none focus-visible:outline-none placeholder:text-ink-500"
        />
        {parsed?.title && <kbd className="font-code text-[11px] text-ink-500">Enter ↵</kbd>}
      </div>
      {parsed && <ParsedChips q={parsed} today={today} />}
    </form>
  );
}
