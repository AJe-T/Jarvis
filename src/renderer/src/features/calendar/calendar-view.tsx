import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  ListChecks,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';
import { PLANNER_COLORS, type Calendar } from '@shared/planner';
import {
  addDays,
  addMinutes,
  parseLocal,
  startOfWeek,
  toDateKey,
  toStamp,
} from '@shared/planner-time';
import type { QuickAdd } from '@shared/quick-add';
import { Button, IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { PageHeader } from '../../components/ui/page';
import { call } from '../../lib/api';
import { plannerCall, usePlannerStore } from '../../stores/planner-store';
import { useUiStore } from '../../stores/ui-store';
import { QuickAddInput } from '../tasks/planner-kit';
import { buildItems, monthGrid, type CalItem } from './calendar-layout';
import { AgendaView, MiniMonth, MonthView, YearView } from './calendar-views';
import { EventEditor, type EditorTarget } from './event-editor';
import { TimeGrid } from './time-grid';

type Mode = 'day' | 'week' | 'month' | 'agenda' | 'year';
const PREFS_KEY = 'jarvis.calendar.view';
const AGENDA_DAYS = 60;
const MODES: Array<[Mode, string, string]> = [
  ['day', 'Day', 'D'],
  ['week', 'Week', 'W'],
  ['month', 'Month', 'M'],
  ['agenda', 'Schedule', 'A'],
  ['year', 'Year', 'Y'],
];

function loadPrefs(): { mode: Mode; showTasks: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as {
      mode?: Mode;
      showTasks?: boolean;
    } | null;
    return {
      mode: v?.mode && MODES.some(([m]) => m === v.mode) ? v.mode : 'week',
      showTasks: v?.showTasks ?? true,
    };
  } catch {
    return { mode: 'week', showTasks: true };
  }
}

function range(mode: Mode, cursor: string): [string, string] {
  if (mode === 'day') return [cursor, cursor];
  if (mode === 'week') return [startOfWeek(cursor), addDays(startOfWeek(cursor), 6)];
  if (mode === 'agenda') return [cursor, addDays(cursor, AGENDA_DAYS - 1)];
  if (mode === 'year') return [`${cursor.slice(0, 4)}-01-01`, `${cursor.slice(0, 4)}-12-31`];
  const g = monthGrid(cursor);
  return [g[0] ?? cursor, g[41] ?? cursor];
}

function step(mode: Mode, cursor: string, dir: number): string {
  const d = parseLocal(cursor);
  if (mode === 'day') return addDays(cursor, dir);
  if (mode === 'week') return addDays(cursor, dir * 7);
  if (mode === 'agenda') return addDays(cursor, dir * 14);
  if (mode === 'year') return toDateKey(new Date(d.getFullYear() + dir, 0, 1));
  return toDateKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
}

function heading(mode: Mode, cursor: string): string {
  const d = parseLocal(cursor);
  if (mode === 'day')
    return d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  if (mode === 'year') return String(d.getFullYear());
  if (mode === 'week') {
    const [a, b] = range(mode, cursor).map(parseLocal) as [Date, Date];
    const sameMonth = a.getMonth() === b.getMonth();
    return `${a.getDate()}${sameMonth ? '' : ` ${a.toLocaleDateString('en-GB', { month: 'short' })}`} – ${b.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function CalendarRow({ cal }: { cal: Calendar }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cal.name);
  const next =
    PLANNER_COLORS[
      (PLANNER_COLORS.indexOf(cal.color as (typeof PLANNER_COLORS)[number]) + 1) %
        PLANNER_COLORS.length
    ];
  return (
    <li className="group flex h-8 items-center gap-2 rounded-sm px-2 text-sm text-ink-300 hover:bg-hover">
      <button
        type="button"
        aria-label={`Change colour of ${cal.name}`}
        title="Change colour"
        onClick={() => void plannerCall(call('calendar:saveCalendar', { id: cal.id, color: next }))}
        className="size-3 shrink-0 rounded-xs border-2"
        style={{ borderColor: cal.color, background: cal.visible ? cal.color : 'transparent' }}
      />
      {editing ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim())
              void plannerCall(call('calendar:saveCalendar', { id: cal.id, name: name.trim() }));
            setEditing(false);
          }}
        >
          <input
            autoFocus
            aria-label="Calendar name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setEditing(false)}
            className="w-full bg-transparent text-ink-100 outline-none focus-visible:outline-none"
          />
        </form>
      ) : (
        <span
          className={clsx('min-w-0 flex-1 truncate', !cal.visible && 'text-ink-500')}
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >
          {cal.name}
        </span>
      )}
      <IconButton
        label={cal.visible ? `Hide ${cal.name}` : `Show ${cal.name}`}
        className="size-6 opacity-0 group-hover:opacity-100"
        onClick={() =>
          void plannerCall(call('calendar:saveCalendar', { id: cal.id, visible: !cal.visible }))
        }
      >
        {cal.visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
      </IconButton>
      <IconButton
        label={`Export ${cal.name}`}
        className="size-6 opacity-0 group-hover:opacity-100"
        onClick={() => void plannerCall(call('calendar:exportIcs', { calendarId: cal.id }))}
      >
        <Download size={13} aria-hidden />
      </IconButton>
      <IconButton
        label={`Delete ${cal.name}`}
        className="size-6 opacity-0 group-hover:opacity-100 hover:text-alarm-500"
        onClick={() =>
          void confirmAction({
            title: `Delete "${cal.name}"?`,
            body: 'Every event in this calendar is deleted too.',
            actionLabel: 'Delete calendar',
            destructive: true,
          }).then((ok) => void (ok && plannerCall(call('calendar:deleteCalendar', { id: cal.id }))))
        }
      >
        <Trash2 size={13} aria-hidden />
      </IconButton>
    </li>
  );
}

/** PRD F26: Calendar — day / week / month / schedule / year, drag to create and move, repeats, reminders, .ics. */
export function CalendarView(): React.JSX.Element {
  const { calendars, events, todos, loaded, refresh, setFocusTodo } = usePlannerStore();
  const go = useUiStore((s) => s.go);
  const toast = useUiStore((s) => s.toast);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [cursor, setCursor] = useState(() => toDateKey(new Date()));
  const [side, setSide] = useState(() => toDateKey(new Date()));
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [newCal, setNewCal] = useState<string | null>(null);
  const today = toDateKey(new Date());
  const { mode, showTasks } = prefs;

  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // not remembered; fine
    }
  }, [prefs]);
  useEffect(() => setSide(cursor), [cursor]);

  const [from, to] = range(mode, cursor);
  const items = useMemo(
    () => buildItems(events, calendars, todos, from, to, { showTasks, query }),
    [events, calendars, todos, from, to, showTasks, query],
  );
  // Dots on the small months: count per day over the year around the cursor.
  const busy = useMemo(() => {
    const y = (mode === 'year' ? cursor : side).slice(0, 4);
    const m = new Map<string, number>();
    for (const it of buildItems(
      events,
      calendars,
      todos,
      `${Number(y) - 1}-12-01`,
      `${Number(y) + 1}-01-31`,
      { showTasks, query: '' },
    ))
      m.set(it.start.slice(0, 10), (m.get(it.start.slice(0, 10)) ?? 0) + 1);
    return m;
  }, [events, calendars, todos, showTasks, cursor, side, mode]);
  const nextUp = useMemo(() => {
    const now = toStamp(new Date());
    return buildItems(events, calendars, [], today, addDays(today, 1), {
      showTasks: false,
      query: '',
    }).find((it) => !it.allDay && it.end > now);
  }, [events, calendars, today]);

  const setMode = (m: Mode): void => setPrefs((p) => ({ ...p, mode: m }));
  const pickDay = (d: string): void => {
    setCursor(d);
    setMode('day');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (editor || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
        return;
      const k = e.key.toLowerCase();
      const m = MODES.find(([, , key]) => key.toLowerCase() === k);
      if (m) setPrefs((p) => ({ ...p, mode: m[0] }));
      else if (k === 't') setCursor(toDateKey(new Date()));
      else if (e.key === 'ArrowLeft' || k === 'j') setCursor((c) => step(mode, c, -1));
      else if (e.key === 'ArrowRight' || k === 'k') setCursor((c) => step(mode, c, 1));
      else if (k === 'n') {
        const s = `${cursor}T${String(Math.min(22, new Date().getHours() + 1)).padStart(2, '0')}:00`;
        setEditor({
          event: null,
          occurrence: null,
          start: s,
          end: addMinutes(s, 60),
          allDay: false,
        });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, mode, cursor]);

  function open(it: CalItem): void {
    if (it.kind === 'task') {
      setFocusTodo(it.id);
      go('tasks');
      return;
    }
    const ev = events.find((e) => e.id === it.id);
    if (ev)
      setEditor({
        event: ev,
        occurrence: ev.recurrence ? { start: it.start, end: it.end, date: it.date } : null,
        start: it.start,
        end: it.end,
        allDay: it.allDay,
      });
  }

  function change(it: CalItem, start: string, end: string): void {
    if (it.kind === 'task') {
      void plannerCall(
        call('todos:save', {
          id: it.id,
          dueDate: start.slice(0, 10),
          dueTime: it.allDay ? null : start.slice(11),
          ...(it.allDay
            ? {}
            : {
                durationMin: Math.max(
                  5,
                  Math.round((parseLocal(end).getTime() - parseLocal(start).getTime()) / 60_000),
                ),
              }),
        }),
      );
      return;
    }
    const ev = events.find((e) => e.id === it.id);
    if (!ev) return;
    if (ev.recurrence) {
      // Dragging one occurrence of a repeating event moves just that one.
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = ev;
      void (async () => {
        if (
          !(await plannerCall(
            call('calendar:save', { ...rest, start, end, recurrence: null, exdates: [] }),
          ))
        )
          return;
        if (await plannerCall(call('calendar:delete', { id: ev.id, date: it.date, scope: 'one' })))
          toast({ level: 'info', message: 'Moved this occurrence only.' });
      })();
    } else void plannerCall(call('calendar:save', { id: ev.id, start, end }));
  }

  function quickAdd(_text: string, q: QuickAdd): void {
    const date = q.date ?? cursor;
    const cal = calendars.find((c) =>
      q.hashtags.some((h) => h.toLowerCase() === c.name.toLowerCase()),
    );
    const start = q.time ? `${date}T${q.time}` : `${date}T00:00`;
    const end = q.time
      ? q.endTime && q.endTime > q.time
        ? `${date}T${q.endTime}`
        : addMinutes(start, q.durationMin ?? 60)
      : `${date}T23:59`;
    void plannerCall(
      call('calendar:save', {
        title: q.title,
        start,
        end,
        allDay: !q.time,
        recurrence: q.recurrence,
        ...(cal ? { calendarId: cal.id } : {}),
      }),
    ).then((ev) => {
      if (!ev) return;
      toast({
        level: 'info',
        message: `Added "${ev.title}" on ${parseLocal(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}.`,
      });
      setCursor(date);
    });
  }

  const create = (start: string, end: string, allDay: boolean): void =>
    setEditor({ event: null, occurrence: null, start, end, allDay });
  const weekDays =
    mode === 'day'
      ? [cursor]
      : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));
  const sideMonthDays = mode === 'week' ? weekDays : mode === 'day' ? [cursor] : [];

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label="Calendars"
        className="hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line-subtle p-3 lg:flex"
      >
        <Button
          variant="primary"
          onClick={() => create(`${cursor}T09:00`, `${cursor}T10:00`, false)}
        >
          <Plus size={14} aria-hidden /> New event
        </Button>
        {nextUp && (
          <button
            type="button"
            onClick={() => open(nextUp)}
            className="card flex flex-col gap-0.5 p-3 text-left"
          >
            <span className="font-code text-[10px] font-semibold tracking-widest text-accent-500 uppercase">
              {nextUp.start <= toStamp(new Date()) ? 'Now' : 'Next up'}
            </span>
            <span className="truncate text-sm font-medium text-ink-100">{nextUp.title}</span>
            <span className="text-xs text-ink-500">
              {nextUp.start.slice(0, 10) === today ? 'Today' : 'Tomorrow'} {nextUp.start.slice(11)}–
              {nextUp.end.slice(11)}
              {nextUp.location && ` · ${nextUp.location}`}
            </span>
          </button>
        )}
        <MiniMonth
          month={side}
          selected={sideMonthDays}
          today={today}
          busy={busy}
          onPick={(d) => setCursor(d)}
          onMonth={(dir) => setSide((s) => step('month', s, dir))}
        />
        <div>
          <div className="mb-1 flex items-center px-2">
            <h2 className="font-code text-[11px] font-semibold tracking-widest text-ink-500 uppercase">
              My calendars
            </h2>
            <IconButton
              label="New calendar"
              className="ml-auto size-6"
              onClick={() => setNewCal('')}
            >
              <Plus size={14} aria-hidden />
            </IconButton>
          </div>
          <ul className="flex flex-col gap-0.5">
            {calendars.map((c) => (
              <CalendarRow key={c.id} cal={c} />
            ))}
          </ul>
          {newCal !== null && (
            <form
              className="mt-1 px-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (newCal.trim())
                  void plannerCall(call('calendar:saveCalendar', { name: newCal.trim() }));
                setNewCal(null);
              }}
            >
              <input
                autoFocus
                aria-label="New calendar name"
                placeholder="Calendar name, Enter"
                value={newCal}
                onChange={(e) => setNewCal(e.target.value)}
                onBlur={() => setNewCal(null)}
                className="h-8 w-full rounded-sm border border-accent-edge bg-surface-1 px-2 text-sm text-ink-100 outline-none focus-visible:outline-none"
              />
            </form>
          )}
          <label className="mt-2 flex h-8 items-center gap-2 px-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={showTasks}
              onChange={(e) => setPrefs((p) => ({ ...p, showTasks: e.target.checked }))}
            />
            <ListChecks size={14} aria-hidden /> Show tasks with due dates
          </label>
        </div>
        <div className="mt-auto flex flex-col gap-1">
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() =>
              void plannerCall(call('calendar:importIcs', {})).then(
                (r) =>
                  r &&
                  toast({
                    level: 'info',
                    message: `Imported ${r.count} events into "${r.name}"${r.skipped ? ` (${r.skipped} with repeats Jarvis can't follow were skipped)` : ''}.`,
                  }),
              )
            }
          >
            <Upload size={14} aria-hidden /> Import .ics
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() =>
              void plannerCall(call('calendar:exportIcs', {})).then(
                (r) => r?.path && toast({ level: 'info', message: `Saved ${r.path}` }),
              )
            }
          >
            <Download size={14} aria-hidden /> Export all (.ics)
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title="Calendar">
          <div className="hidden items-center gap-1 rounded-sm border border-line px-2 focus-within:border-accent-edge xl:flex">
            <Search size={13} aria-hidden className="text-ink-500" />
            <input
              aria-label="Search events"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-7 w-28 bg-transparent text-sm text-ink-100 outline-none focus-visible:outline-none placeholder:text-ink-500"
            />
          </div>
          <div
            className="flex rounded-sm border border-line p-0.5"
            role="radiogroup"
            aria-label="Calendar view"
          >
            {MODES.map(([m, label, key]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                title={`${label} (${key})`}
                onClick={() => setMode(m)}
                className={clsx(
                  'h-7 rounded-xs px-2.5 text-xs font-medium transition-colors',
                  mode === m ? 'bg-selected text-ink-100' : 'text-ink-500 hover:text-ink-100',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </PageHeader>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-2 md:px-6">
          <Button className="h-8" onClick={() => setCursor(toDateKey(new Date()))}>
            Today
          </Button>
          <IconButton label="Previous" hint="←" onClick={() => setCursor((c) => step(mode, c, -1))}>
            <ChevronLeft size={16} aria-hidden />
          </IconButton>
          <IconButton label="Next" hint="→" onClick={() => setCursor((c) => step(mode, c, 1))}>
            <ChevronRight size={16} aria-hidden />
          </IconButton>
          <h2 className="mr-auto text-lg font-semibold text-ink-100">{heading(mode, cursor)}</h2>
          <div className="w-full max-w-md md:w-80">
            <QuickAddInput
              today={today}
              placeholder="Quick add: lunch with Sam fri 1-2pm"
              onSubmit={quickAdd}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === 'month' && (
            <MonthView
              cursor={cursor}
              items={items}
              today={today}
              onOpen={open}
              onCreate={create}
              onChange={change}
              onPickDay={pickDay}
            />
          )}
          {(mode === 'week' || mode === 'day') && (
            <TimeGrid
              days={weekDays}
              items={items}
              today={today}
              onOpen={open}
              onCreate={create}
              onChange={change}
              onPickDay={pickDay}
            />
          )}
          {mode === 'agenda' && (
            <AgendaView
              from={cursor}
              days={AGENDA_DAYS}
              items={items}
              today={today}
              onOpen={open}
            />
          )}
          {mode === 'year' && (
            <YearView
              year={Number(cursor.slice(0, 4))}
              today={today}
              busy={busy}
              onPick={pickDay}
            />
          )}
        </div>
      </div>
      {editor && (
        <EventEditor target={editor} calendars={calendars} onClose={() => setEditor(null)} />
      )}
    </div>
  );
}
