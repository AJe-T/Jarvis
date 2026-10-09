import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bell, MapPin, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { CalEvent, Calendar, Recurrence } from '@shared/planner';
import { addMinutes, minutesBetween } from '@shared/planner-time';
import { Button, IconButton } from '../../components/ui/button';
import { Switch } from '../../components/ui/field';
import { call } from '../../lib/api';
import { plannerCall } from '../../stores/planner-store';
import { RepeatPicker, selectClass } from '../tasks/planner-kit';

export interface EditorTarget {
  /** Existing event, or null for a new one. */
  event: CalEvent | null;
  /** The occurrence clicked (for repeating events). */
  occurrence: { start: string; end: string; date: string } | null;
  /** Prefill for a new event (from a click or drag on the grid). */
  start: string;
  end: string;
  allDay: boolean;
  title?: string;
}

const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440];
const reminderLabel = (m: number): string =>
  m === 0 ? 'At start' : m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : `${m / 1440} day`;

/** Create or edit an event; for a repeating event Sir picks "this one" or "all of them". */
export function EventEditor({
  target,
  calendars,
  onClose,
}: {
  target: EditorTarget;
  calendars: Calendar[];
  onClose: () => void;
}): React.JSX.Element {
  const ev = target.event;
  const occ = target.occurrence;
  const [title, setTitle] = useState(ev?.title ?? target.title ?? '');
  const [calendarId, setCalendarId] = useState(
    ev?.calendarId ?? calendars.find((c) => c.visible)?.id ?? calendars[0]?.id ?? '',
  );
  const [allDay, setAllDay] = useState(ev?.allDay ?? target.allDay);
  const [start, setStart] = useState(occ?.start ?? ev?.start ?? target.start);
  const [end, setEnd] = useState(occ?.end ?? ev?.end ?? target.end);
  const [location, setLocation] = useState(ev?.location ?? '');
  const [notes, setNotes] = useState(ev?.notes ?? '');
  const [recurrence, setRecurrence] = useState<Recurrence | null>(ev?.recurrence ?? null);
  const [reminders, setReminders] = useState<number[]>(ev?.reminders ?? [10]);
  const [scope, setScope] = useState<'one' | 'all'>('all');
  const [deleting, setDeleting] = useState(false);
  const repeating = !!ev?.recurrence && !!occ;

  const setStartKeepLength = (s: string): void => {
    const len = Math.max(allDay ? 0 : 15, minutesBetween(start, end));
    setStart(s);
    setEnd(addMinutes(s, len));
  };

  async function save(): Promise<void> {
    if (!title.trim() || !calendarId) return;
    const fields = {
      title: title.trim(),
      calendarId,
      allDay,
      start,
      end: end < start ? start : end,
      location,
      notes,
      reminders,
    };
    if (!ev) {
      await plannerCall(call('calendar:save', { ...fields, recurrence }));
    } else if (repeating && scope === 'one') {
      // Just this date: a standalone copy, and the series skips the day.
      const done = await plannerCall(call('calendar:save', { ...fields, recurrence: null }));
      if (done)
        await plannerCall(call('calendar:delete', { id: ev.id, date: occ.date, scope: 'one' }));
    } else {
      // The whole series moves by however much this occurrence moved.
      const shift = occ ? minutesBetween(occ.start, start) : 0;
      const length = minutesBetween(start, fields.end);
      const seriesStart = occ ? addMinutes(ev.start, shift) : start;
      await plannerCall(
        call('calendar:save', {
          id: ev.id,
          ...fields,
          start: seriesStart,
          end: addMinutes(seriesStart, length),
          recurrence,
        }),
      );
    }
    onClose();
  }

  async function remove(which: 'one' | 'following' | 'all'): Promise<void> {
    if (!ev) return;
    await plannerCall(
      call('calendar:delete', { id: ev.id, ...(occ ? { date: occ.date } : {}), scope: which }),
    );
    onClose();
  }

  const color = calendars.find((c) => c.id === calendarId)?.color ?? '#22d3ee';
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim fade-in fixed inset-0 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="dialog modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(34rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
        >
          <div className="h-1 rounded-t-md" style={{ background: color }} />
          <header className="flex items-center gap-2 px-5 pt-4">
            <Dialog.Title className="font-code text-xs font-semibold tracking-widest text-ink-500 uppercase">
              {ev ? 'Edit event' : 'New event'}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close" className="ml-auto">
                <X size={16} aria-hidden />
              </IconButton>
            </Dialog.Close>
          </header>
          <form
            className="flex flex-col gap-3 overflow-y-auto px-5 pt-2 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              autoFocus
              aria-label="Title"
              placeholder="Add a title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border-b border-line bg-transparent pb-1 text-xl font-semibold text-ink-100 outline-none focus-visible:outline-none focus:border-accent-edge"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                aria-label="Calendar"
                className={selectClass}
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Switch label="All day" checked={allDay} onChange={setAllDay} />
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2 text-sm text-ink-300">
              <span>Starts</span>
              <input
                type="date"
                aria-label="Start date"
                className={selectClass}
                value={start.slice(0, 10)}
                onChange={(e) =>
                  e.target.value && setStartKeepLength(`${e.target.value}${start.slice(10)}`)
                }
              />
              {allDay ? (
                <span />
              ) : (
                <input
                  type="time"
                  step={300}
                  aria-label="Start time"
                  className={selectClass}
                  value={start.slice(11, 16)}
                  onChange={(e) =>
                    e.target.value && setStartKeepLength(`${start.slice(0, 10)}T${e.target.value}`)
                  }
                />
              )}
              <span>Ends</span>
              <input
                type="date"
                aria-label="End date"
                className={selectClass}
                value={end.slice(0, 10)}
                min={start.slice(0, 10)}
                onChange={(e) => e.target.value && setEnd(`${e.target.value}${end.slice(10)}`)}
              />
              {allDay ? (
                <span />
              ) : (
                <input
                  type="time"
                  step={300}
                  aria-label="End time"
                  className={selectClass}
                  value={end.slice(11, 16)}
                  onChange={(e) =>
                    e.target.value && setEnd(`${end.slice(0, 10)}T${e.target.value}`)
                  }
                />
              )}
            </div>
            {!allDay && end > start && (
              <p className="-mt-1 text-xs text-ink-500">
                {(() => {
                  const m = minutesBetween(start, end);
                  return m >= 60
                    ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
                    : `${m} min`;
                })()}
              </p>
            )}
            <label className="flex items-center gap-2 rounded-sm border border-line bg-surface-1 px-2">
              <MapPin size={14} aria-hidden className="text-ink-500" />
              <input
                aria-label="Location"
                placeholder="Location or meeting link"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="h-8 flex-1 bg-transparent text-sm text-ink-100 outline-none focus-visible:outline-none"
              />
            </label>
            {(!ev || !repeating || scope === 'all') && (
              <RepeatPicker
                value={recurrence}
                onChange={setRecurrence}
                startDate={start.slice(0, 10)}
              />
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <Bell size={14} aria-label="Reminders" className="text-ink-500" />
              {REMINDER_CHOICES.map((m) => {
                const on = reminders.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setReminders(
                        on ? reminders.filter((x) => x !== m) : [...reminders, m].slice(-5),
                      )
                    }
                    className={clsx(
                      'rounded-pill border px-2 py-0.5 text-xs transition-colors',
                      on
                        ? 'border-accent-edge bg-accent-tint text-accent-tag-ink'
                        : 'border-line text-ink-500 hover:bg-hover',
                    )}
                  >
                    {reminderLabel(m)}
                  </button>
                );
              })}
            </div>
            <textarea
              aria-label="Notes"
              placeholder="Notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-y rounded-sm border border-line bg-surface-1 p-2 text-sm text-ink-100 outline-none focus-visible:outline-none focus:border-accent-edge"
            />
            {repeating && (
              <fieldset className="flex items-center gap-4 text-sm text-ink-300">
                <legend className="sr-only">Apply changes to</legend>
                Apply to:
                {(['one', 'all'] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === s}
                      onChange={() => setScope(s)}
                    />
                    {s === 'one' ? 'This event' : 'All events'}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="flex items-center gap-2 border-t border-line-subtle pt-3">
              {ev &&
                (deleting && repeating ? (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="danger"
                      className="h-8 px-2"
                      onClick={() => void remove('one')}
                    >
                      This one
                    </Button>
                    <Button
                      variant="danger"
                      className="h-8 px-2"
                      onClick={() => void remove('following')}
                    >
                      This & following
                    </Button>
                    <Button
                      variant="danger"
                      className="h-8 px-2"
                      onClick={() => void remove('all')}
                    >
                      All
                    </Button>
                  </div>
                ) : deleting ? (
                  <Button variant="danger" onClick={() => void remove('all')}>
                    Confirm delete
                  </Button>
                ) : (
                  <IconButton label="Delete event" onClick={() => setDeleting(true)}>
                    <Trash2 size={15} aria-hidden />
                  </IconButton>
                ))}
              <span className="ml-auto hidden text-xs text-ink-500 sm:inline">
                Ctrl+Enter saves
              </span>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={!title.trim()}>
                Save
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
