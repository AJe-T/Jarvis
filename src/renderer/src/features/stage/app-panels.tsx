import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeftRight, CheckSquare, Copy, Delete, Plus, Square, X } from 'lucide-react';
import type { StagePanel } from '@shared/stage';
import { occurrencesBetween, toDateKey } from '@shared/planner-time';
import { Button, IconButton } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call } from '../../lib/api';
import { plannerCall, usePlannerStore } from '../../stores/planner-store';
import { useUiStore } from '../../stores/ui-store';
import { evaluate, formatResult } from '@shared/calc';
import { convert, UNIT_CATEGORIES } from './units';

/** Apps on Core's stage (Design-system.md §5.2a). Everything runs on this PC. */

const select =
  'min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-300';

function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function keep(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage off: not remembered
  }
}

// ── Today ──────────────────────────────────────────────────────────────────────────────────

export function TodayApp(): React.JSX.Element {
  const { todos, events, calendars, loaded, refresh } = usePlannerStore();
  const go = useUiStore((s) => s.go);
  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  const today = toDateKey(new Date());
  const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
  const dayEvents = events
    .filter((e) => visible.has(e.calendarId))
    .flatMap((e) =>
      occurrencesBetween(e, `${today}T00:00`, `${today}T23:59`).map((o) => ({ e, o })),
    )
    .sort((a, b) => a.o.start.localeCompare(b.o.start));
  const due = todos
    .filter((t) => t.status !== 'done' && !t.parentId && t.dueDate && t.dueDate <= today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.priority - b.priority);
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Events today">
        <h3 className="hud-label mb-2">events</h3>
        {dayEvents.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing on the calendar today.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dayEvents.map(({ e, o }) => (
              <li key={`${e.id}${o.start}`} className="inset flex gap-3 px-3 py-2">
                <span className="w-20 shrink-0 font-code text-xs text-accent-300 tabular">
                  {e.allDay ? 'all day' : `${o.start.slice(11, 16)}–${o.end.slice(11, 16)}`}
                </span>
                <span className="min-w-0 text-ink-100">
                  {e.title}
                  {e.location && <span className="block text-xs text-ink-500">{e.location}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Tasks due">
        <h3 className="hud-label mb-2">tasks</h3>
        {due.length === 0 ? (
          <p className="text-sm text-ink-500">No tasks due. Nice.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {due.map((t) => (
              <li key={t.id} className="inset flex items-start gap-2.5 px-3 py-2">
                <IconButton
                  label={`Complete ${t.title}`}
                  onClick={() => void plannerCall(call('todos:save', { id: t.id, status: 'done' }))}
                >
                  <Square size={16} aria-hidden />
                </IconButton>
                <span className="min-w-0 pt-1">
                  <span className="block text-ink-100">{t.title}</span>
                  <span
                    className={clsx(
                      'block text-xs',
                      (t.dueDate ?? '') < today ? 'text-alarm-500' : 'text-ink-500',
                    )}
                  >
                    {(t.dueDate ?? '') < today ? `overdue (${t.dueDate})` : 'today'}
                    {t.dueTime ? ` · ${t.dueTime}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex gap-2">
        <Button onClick={() => go('tasks')}>
          <CheckSquare size={14} aria-hidden /> Open Tasks
        </Button>
        <Button onClick={() => go('calendar')}>Open Calendar</Button>
      </div>
    </div>
  );
}

// ── Calculator ─────────────────────────────────────────────────────────────────────────────

const KEYS = [
  'C',
  '(',
  ')',
  '÷',
  '7',
  '8',
  '9',
  '×',
  '4',
  '5',
  '6',
  '−',
  '1',
  '2',
  '3',
  '+',
  '0',
  '.',
  '%',
  '=',
];

export function CalculatorApp({ expression = '' }: { expression?: string }): React.JSX.Element {
  const [expr, setExpr] = useState(expression);
  const [history, setHistory] = useState<Array<{ expr: string; result: string }>>([]);
  const [error, setError] = useState('');
  const preview = useMemo(() => {
    try {
      return expr.trim() ? formatResult(evaluate(expr)) : '';
    } catch {
      return '';
    }
  }, [expr]);
  const run = (): void => {
    try {
      const result = formatResult(evaluate(expr));
      setHistory((h) => [{ expr, result }, ...h].slice(0, 6));
      setExpr(result);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'not a sum');
    }
  };
  const press = (k: string): void => {
    setError('');
    if (k === 'C') setExpr('');
    else if (k === '=') run();
    else setExpr((x) => x + k);
  };
  return (
    <div className="flex flex-col gap-3">
      <label className="sr-only" htmlFor="calc-input">
        Sum
      </label>
      <TextInput
        id="calc-input"
        autoFocus
        value={expr}
        onChange={(e) => {
          setExpr(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run();
          if (e.key === 'Escape') setExpr('');
        }}
        className="text-right font-code text-xl"
        placeholder="0"
      />
      <p className="min-h-5 text-right font-code text-sm text-ink-500" aria-live="polite">
        {error ? <span className="text-alarm-500">{error}</span> : preview && `= ${preview}`}
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {KEYS.map((k) => (
          <Button
            key={k}
            variant={k === '=' ? 'primary' : 'secondary'}
            className="h-11 font-code text-base"
            onClick={() => press(k)}
          >
            {k}
          </Button>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <IconButton label="Delete last character" onClick={() => setExpr((x) => x.slice(0, -1))}>
          <Delete size={16} aria-hidden />
        </IconButton>
        {preview && (
          <IconButton
            label="Copy the answer"
            onClick={() => void navigator.clipboard.writeText(preview)}
          >
            <Copy size={16} aria-hidden />
          </IconButton>
        )}
      </div>
      {history.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line-subtle pt-2 font-code text-xs">
          {history.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                className="w-full text-right text-ink-500 hover:text-ink-100"
                onClick={() => setExpr(h.result)}
              >
                {h.expr} = <span className="text-ink-300">{h.result}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Unit converter ─────────────────────────────────────────────────────────────────────────

export function ConverterApp(): React.JSX.Element {
  const [category, setCategory] = useState('length');
  const units = UNIT_CATEGORIES.find((c) => c.id === category)?.units ?? [];
  const [from, setFrom] = useState('km');
  const [to, setTo] = useState('mi');
  const [value, setValue] = useState('1');
  const pick = (id: string): void => {
    const u = UNIT_CATEGORIES.find((c) => c.id === id)?.units ?? [];
    setCategory(id);
    setFrom(u[0]?.id ?? '');
    setTo(u[1]?.id ?? '');
  };
  let result = '';
  try {
    const n = Number(value);
    if (value.trim() && Number.isFinite(n)) result = formatResult(convert(n, category, from, to));
  } catch {
    result = '';
  }
  const unitSelect = (label: string, v: string, set: (v: string) => void): React.JSX.Element => (
    <select aria-label={label} className={select} value={v} onChange={(e) => set(e.target.value)}>
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.label}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to convert">
        {UNIT_CATEGORIES.map((c) => (
          <Button
            key={c.id}
            variant={c.id === category ? 'primary' : 'ghost'}
            className="h-8 px-2.5 text-sm"
            onClick={() => pick(c.id)}
          >
            {c.label}
          </Button>
        ))}
      </div>
      <TextInput
        aria-label="Value"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="font-code text-lg"
      />
      <div className="flex items-center gap-2">
        {unitSelect('From', from, setFrom)}
        <IconButton
          label="Swap units"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowLeftRight size={16} aria-hidden />
        </IconButton>
        {unitSelect('To', to, setTo)}
      </div>
      <p className="font-display text-3xl text-ink-100 tabular" aria-live="polite">
        {result || '—'}
      </p>
    </div>
  );
}

// ── World clock ────────────────────────────────────────────────────────────────────────────

const CLOCKS_KEY = 'jarvis.worldClocks';
const DEFAULT_ZONES = ['Europe/London', 'America/New_York', 'Asia/Dubai', 'Asia/Tokyo'];

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: 'timeZone'): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return DEFAULT_ZONES;
  }
}

const city = (zone: string): string => zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;

export function WorldClockApp(): React.JSX.Element {
  const now = useNow(1000);
  const [list, setList] = useState<string[]>(() => load(CLOCKS_KEY, DEFAULT_ZONES));
  const [adding, setAdding] = useState('');
  const all = useMemo(zones, []);
  const save = (next: string[]): void => {
    setList(next);
    keep(CLOCKS_KEY, next);
  };
  const time = (zone?: string): string =>
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      ...(zone ? { timeZone: zone } : { second: '2-digit' }),
    }).format(now);
  const day = (zone: string): string =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: zone }).format(now);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-display text-5xl text-ink-100 tabular">{time()}</p>
        <p className="text-sm text-ink-500">
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(now)}
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {list.map((z) => (
          <li key={z} className="inset flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-ink-100">{city(z)}</span>
            <span className="text-xs text-ink-500">{day(z)}</span>
            <span className="font-code text-lg text-ink-100 tabular">{time(z)}</span>
            <IconButton
              label={`Remove ${city(z)}`}
              onClick={() => save(list.filter((x) => x !== z))}
            >
              <X size={14} aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <select
          aria-label="Add a city"
          className={clsx(select, 'min-w-0 flex-1')}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        >
          <option value="">Add a city…</option>
          {all
            .filter((z) => !list.includes(z))
            .map((z) => (
              <option key={z} value={z}>
                {city(z)} ({z.split('/')[0]})
              </option>
            ))}
        </select>
        <Button
          disabled={!adding}
          onClick={() => {
            save([...list, adding]);
            setAdding('');
          }}
        >
          <Plus size={14} aria-hidden /> Add
        </Button>
      </div>
    </div>
  );
}

// ── Picture ────────────────────────────────────────────────────────────────────────────────

export function ImagePanel({
  src,
  title,
}: Extract<StagePanel, { kind: 'image' }>): React.JSX.Element {
  return (
    <img
      src={src}
      alt={title}
      className="mx-auto block max-h-full max-w-full rounded-md object-contain"
    />
  );
}
