import type { ScheduleInput as Schedule } from '@shared/schedule';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const INPUT = 'min-h-8 rounded-md border border-line bg-surface-2 px-2 text-ink-100';

const TYPES: Record<Schedule['type'], string> = {
  daily: 'At a time',
  interval: 'Every…',
  once: 'Once',
  monthly: 'Monthly',
  startup: 'When Jarvis starts',
};

/** "YYYY-MM-DDTHH:mm" for tomorrow 09:00, local time (what datetime-local wants). */
function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

const fresh = (type: Schedule['type']): Schedule => {
  switch (type) {
    case 'daily':
      return { type, time: '09:00', days: [] };
    case 'interval':
      return { type, minutes: 60 };
    case 'once':
      return { type, at: tomorrowNine() };
    case 'monthly':
      return { type, day: 1, time: '09:00' };
    case 'startup':
      return { type, delayMinutes: 0 };
  }
};

/** When an automation runs: at a time on chosen days, every N minutes, once, monthly, or at start. */
export function ScheduleEditor({
  value,
  onChange,
}: {
  value: Schedule;
  onChange(s: Schedule): void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-ink-300">
      <select
        aria-label="Schedule type"
        value={value.type}
        onChange={(e) => onChange(fresh(e.target.value as Schedule['type']))}
        className={INPUT}
      >
        {Object.entries(TYPES).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      {value.type === 'daily' && (
        <>
          <input
            type="time"
            aria-label="Time"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            className={INPUT}
          />
          {DAYS.map((d, i) => {
            const days = value.days ?? [];
            return (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={days.includes(i + 1)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      days: e.target.checked
                        ? [...days, i + 1].sort((a, b) => a - b)
                        : days.filter((x) => x !== i + 1),
                    })
                  }
                />
                {d}
              </label>
            );
          })}
          <span className="text-ink-500">(no days ticked = every day)</span>
        </>
      )}
      {value.type === 'interval' && (
        <label className="flex items-center gap-2">
          <input
            type="number"
            min={15}
            step={15}
            aria-label="Minutes"
            value={value.minutes}
            onChange={(e) =>
              onChange({ type: 'interval', minutes: Math.max(15, Number(e.target.value) || 15) })
            }
            className={`${INPUT} w-24`}
          />
          minutes
        </label>
      )}
      {value.type === 'once' && (
        <input
          type="datetime-local"
          aria-label="Date and time"
          value={value.at}
          onChange={(e) => e.target.value && onChange({ type: 'once', at: e.target.value })}
          className={INPUT}
        />
      )}
      {value.type === 'monthly' && (
        <>
          <label className="flex items-center gap-2">
            on day
            <input
              type="number"
              min={1}
              max={31}
              aria-label="Day of the month"
              value={value.day}
              onChange={(e) =>
                onChange({
                  ...value,
                  day: Math.min(31, Math.max(1, Math.round(Number(e.target.value) || 1))),
                })
              }
              className={`${INPUT} w-16`}
            />
          </label>
          <input
            type="time"
            aria-label="Time"
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
            className={INPUT}
          />
          {value.day > 28 && (
            <span className="text-ink-500">(shorter months: on their last day)</span>
          )}
        </>
      )}
      {value.type === 'startup' && (
        <label className="flex items-center gap-2">
          after
          <input
            type="number"
            min={0}
            max={120}
            aria-label="Minutes after start"
            value={value.delayMinutes}
            onChange={(e) =>
              onChange({
                type: 'startup',
                delayMinutes: Math.min(120, Math.max(0, Math.round(Number(e.target.value) || 0))),
              })
            }
            className={`${INPUT} w-20`}
          />
          minutes
        </label>
      )}
    </div>
  );
}
