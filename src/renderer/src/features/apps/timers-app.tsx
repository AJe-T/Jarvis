import { useCallback, useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';

type Reminder = Res<'reminders:list'>[number];

const QUICK = [1, 5, 10, 15, 25, 45];
const REFRESH_MS = 5_000;

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

/** Countdowns and reminders (they fire as a notification and Jarvis says them), plus a stopwatch. */
export function TimersApp(): React.JSX.Element {
  const toast = useUiStore((s) => s.toast);
  const [items, setItems] = useState<Reminder[]>([]);
  const [now, setNow] = useState(Date.now());
  const [minutes, setMinutes] = useState('3');
  const [label, setLabel] = useState('Timer');

  const load = useCallback(
    () =>
      void call('reminders:list', {})
        .then((r) =>
          setItems(
            r
              .filter((x) => x.status === 'scheduled' && Date.parse(x.dueAt) > Date.now())
              .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)),
          ),
        )
        .catch(() => undefined),
    [],
  );
  useEffect(() => {
    load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, REFRESH_MS);
    return () => (clearInterval(tick), clearInterval(poll));
  }, [load]);

  const add = (secs: number, name: string): void =>
    void call('apps:timerAdd', { seconds: Math.round(secs), label: name.trim() || 'Timer' })
      .then(load)
      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section aria-label="Timers" className="card flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold text-ink-100">Countdown</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((m) => (
            <Button key={m} variant="secondary" onClick={() => add(m * 60, `${m} min timer`)}>
              {m} min
            </Button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const m = Number(minutes);
            if (m > 0 && m <= 1440) add(m * 60, label);
          }}
        >
          <TextInput
            aria-label="Minutes"
            type="number"
            min={0.1}
            max={1440}
            step="any"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-24"
          />
          <span className="text-sm text-ink-300">min</span>
          <TextInput
            aria-label="Label"
            value={label}
            maxLength={100}
            onChange={(e) => setLabel(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="primary">
            Start
          </Button>
        </form>
        <h3 className="text-sm font-semibold text-ink-300">Running and upcoming</h3>
        {items.length === 0 ? (
          <p className="text-sm text-ink-500">
            Nothing running. Jarvis’s timers and reminders show here too.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((r) => {
              const left = Date.parse(r.dueAt) - now;
              return (
                <li key={r.id} className="inset flex items-center gap-3 rounded-lg px-3 py-2">
                  <span className="font-code text-xl text-accent-300 tabular">{clock(left)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-100">
                    {r.text.replace(/ is done\.$/, '')}
                  </span>
                  <span className="text-xs text-ink-500 tabular">
                    {new Date(r.dueAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void call('apps:timerCancel', { id: r.id })
                        .then(load)
                        .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
                    }
                  >
                    Cancel
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Stopwatch />
    </div>
  );
}

function Stopwatch(): React.JSX.Element {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [banked, setBanked] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [startedAt]);
  const elapsed = banked + (startedAt === null ? 0 : Date.now() - startedAt);
  const fine = (ms: number): string =>
    `${clock(ms - (ms % 1000))}.${Math.floor((ms % 1000) / 100)}`;
  return (
    <section aria-label="Stopwatch" className="card flex flex-col gap-4 p-5">
      <h2 className="text-base font-semibold text-ink-100">Stopwatch</h2>
      <p className="font-code text-5xl text-ink-100 tabular" aria-live="off">
        {fine(elapsed)}
      </p>
      <div className="flex gap-2">
        {startedAt === null ? (
          <Button variant="primary" onClick={() => setStartedAt(Date.now())}>
            {elapsed ? 'Resume' : 'Start'}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => (setBanked(elapsed), setStartedAt(null))}>
            Pause
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={startedAt === null}
          onClick={() => setLaps((l) => [elapsed, ...l])}
        >
          Lap
        </Button>
        <Button
          variant="ghost"
          disabled={!elapsed}
          onClick={() => (setStartedAt(null), setBanked(0), setLaps([]))}
        >
          Reset
        </Button>
      </div>
      {laps.length > 0 && (
        <ol className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
          {laps.map((l, i) => (
            <li key={laps.length - i} className="flex justify-between text-ink-300 tabular">
              <span>Lap {laps.length - i}</span>
              <span>{fine(l - (laps[i + 1] ?? 0))}</span>
              <span className="text-ink-500">{fine(l)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
