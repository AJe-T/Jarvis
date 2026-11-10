import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';

type Day = Res<'timeline:day'>;

/** 4980 → "1 h 23 min". */
export function duration(seconds: number): string {
  const min = Math.round(seconds / 60);
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

/** YYYY-MM-DD moved by whole days, in local time. */
export function shiftDay(day: string, by: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d + by);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/** Activity → My day: time per app from the day timeline, one day at a time. */
export function DayPanel(): React.JSX.Element {
  const on = useSetting('timeline.enabled') === true;
  const go = useUiStore((s) => s.go);
  const [data, setData] = useState<Day | null>(null);
  const [today, setToday] = useState<string | null>(null);

  const load = useCallback(async (day?: string) => {
    const d = await call('timeline:day', day ? { day } : {}).catch(() => null);
    if (!d) return;
    setData(d);
    if (!day) setToday(d.day);
  }, []);
  useEffect(() => void load(), [load]);

  if (!data) return <p className="text-sm text-ink-500">Loading…</p>;
  const longest = data.apps[0]?.seconds ?? 1;
  return (
    <section aria-label="My day" className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          aria-label="Previous day"
          onClick={() => void load(shiftDay(data.day, -1))}
        >
          <ChevronLeft size={14} aria-hidden />
        </Button>
        <h2 className="font-code text-sm text-ink-100 tabular">{data.day}</h2>
        <Button
          variant="ghost"
          aria-label="Next day"
          disabled={data.day === today}
          onClick={() => void load(shiftDay(data.day, 1))}
        >
          <ChevronRight size={14} aria-hidden />
        </Button>
        <p className="text-sm text-ink-300">
          {data.apps.length ? `${duration(data.totalSeconds)} at the PC` : 'Nothing recorded'}
        </p>
        <Button
          className="ml-auto"
          onClick={() =>
            void confirmAction({
              title: 'Delete the whole day timeline?',
              body: 'Every recorded day is deleted. This cannot be undone.',
              actionLabel: 'Delete',
              destructive: true,
            }).then(async (yes) => {
              if (!yes) return;
              await call('timeline:clear', {});
              await load();
            })
          }
        >
          Clear
        </Button>
      </div>

      {!on && (
        <p className="rounded-md bg-surface-2 p-3 text-sm text-ink-300">
          The day timeline is off, so nothing new is recorded.{' '}
          <button type="button" className="underline" onClick={() => go('settings', 'privacy')}>
            Turn it on in Privacy
          </button>
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {data.apps.map((a) => (
          <li key={a.process}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-ink-100">{a.process}</span>
              <span className="shrink-0 font-code text-xs text-ink-300 tabular">
                {duration(a.seconds)}
              </span>
            </div>
            <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full origin-left rounded-full bg-accent-500"
                style={{ transform: `scaleX(${a.seconds / longest})` }}
              />
            </div>
            {a.windows.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {a.windows.map((w) => (
                  <li key={w.title} className="flex justify-between gap-3 text-xs text-ink-500">
                    <span className="truncate">{w.title}</span>
                    <span className="shrink-0 font-code tabular">{duration(w.seconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
