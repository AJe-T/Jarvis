import { describe, expect, it } from 'vitest';
import { logger } from '@main/logging/logger';
import { parseIcs } from '@main/planner/ics';
import { addDays, toDateKey } from '@shared/planner-time';
import { setupServices } from './helpers';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

function setup() {
  const t = setupServices();
  const tool = (name: 'tasks' | 'calendar') => {
    const tl = t.services.registry.get(name);
    if (!tl) throw new Error(`no ${name} tool`);
    return async (input: unknown): Promise<string> =>
      (await tl.run(tl.input.parse(input), ctx)).content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('');
  };
  const notices = (): string[] =>
    t.events
      .filter((e) => e.event === 'notify')
      .map((e) => (e.payload as { message: string }).message);
  return {
    ...t,
    planner: t.services.planner,
    tasks: tool('tasks'),
    calendar: tool('calendar'),
    notices,
  };
}

describe('Tasks', () => {
  it('lists keep a description, a Doing limit and an archived flag; a patch changes only what it names', () => {
    const t = setup();
    const l = t.planner.saveList({ name: 'Launch', description: 'Ship v3', wipLimit: 2 });
    expect(l).toMatchObject({ description: 'Ship v3', wipLimit: 2, archived: false });
    const patched = t.planner.saveList({ id: l.id, archived: true });
    expect(patched).toMatchObject({
      name: 'Launch',
      description: 'Ship v3',
      wipLimit: 2,
      archived: true,
    });
    expect(t.planner.saveList({ id: l.id, wipLimit: null }).wipLimit).toBeNull();
    expect(t.planner.lists().find((x) => x.id === l.id)?.archived).toBe(true);
    expect(() => t.planner.saveList({ description: 'no name' })).toThrow();
  });

  it('adds from natural language, reminds once at the due time, and lists today', async () => {
    const t = setup();
    t.planner.saveList({ name: 'Home' });
    const out = await t.tasks({ action: 'add', text: 'Pay rent today 9am #home #bills !1' });
    expect(out).toMatch(/Added: td_.* Pay rent · due .* 09:00 · P1 · Home · #bills/);
    const todo = t.planner.todos()[0];
    expect(todo?.remindAt).toBe(`${toDateKey(new Date())}T09:00`);
    t.planner.tick(new Date(new Date().setHours(9, 0, 30)));
    t.planner.tick(new Date(new Date().setHours(9, 1, 0)));
    expect(t.notices().filter((m) => m.includes('Pay rent'))).toHaveLength(1);
    expect(await t.tasks({ action: 'list' })).toContain('Pay rent');
    expect(t.events.some((e) => e.event === 'planner:changed')).toBe(true);
  });

  it('rolls a repeating task forward and keeps a done copy; finishing a one-off task finishes subtasks', async () => {
    const t = setup();
    const today = toDateKey(new Date());
    const parent = t.planner.saveTodo({
      title: 'Water plants',
      dueDate: today,
      recurrence: { freq: 'daily', interval: 2 },
    });
    const sub = t.planner.saveTodo({ title: 'Fill can', parentId: parent.id });
    expect(await t.tasks({ action: 'complete', query: 'water plants' })).toMatch(/repeats/);
    const after = t.planner.todo(parent.id);
    expect(after?.status).toBe('todo');
    expect(after?.dueDate).toBe(addDays(today, 2));
    expect(
      t.planner.todos().filter((x) => x.title === 'Water plants' && x.status === 'done'),
    ).toHaveLength(1);
    // The next round starts with its subtasks open again.
    expect(t.planner.todo(sub.id)?.status).toBe('todo');
    const once = t.planner.saveTodo({ title: 'Pack' });
    const item = t.planner.saveTodo({ title: 'Charger', parentId: once.id });
    t.planner.saveTodo({ id: once.id, status: 'done' });
    expect(t.planner.todo(item.id)?.status).toBe('done');
    expect(() => t.planner.saveTodo({ title: 'Deep', parentId: sub.id })).toThrow();
  });

  it('asks before deleting and asks which one when several match', async () => {
    const t = setup();
    t.planner.saveTodo({ title: 'Call mom' });
    t.planner.saveTodo({ title: 'Call dad' });
    const tool = t.services.registry.get('tasks');
    const del = tool?.input.parse({ action: 'delete', query: 'call' });
    expect(typeof tool?.tier === 'function' ? tool.tier(del) : tool?.tier).toBe('CONFIRM');
    expect(await t.tasks({ action: 'complete', query: 'call' })).toMatch(/Several match/);
    expect(await t.tasks({ action: 'delete', query: 'call mom' })).toMatch(/Deleted "Call mom"/);
  });
});

describe('Calendar', () => {
  it('adds events from text, shows repeats and due tasks in the agenda, and finds free time', async () => {
    const t = setup();
    const today = toDateKey(new Date());
    await t.calendar({ action: 'add', text: 'Standup every weekday 10-10:15am', calendar: 'Work' });
    await t.calendar({
      action: 'add',
      title: 'Lunch',
      start: `${today}T13:00`,
      end: `${today}T14:00`,
      location: 'Cafe',
    });
    t.planner.saveTodo({ title: 'Send invoice', dueDate: today });
    // Any 7 days in a row hold exactly 5 weekdays.
    const first =
      t.planner
        .events()
        .find((e) => e.title === 'Standup')
        ?.start.slice(0, 10) ?? '';
    const week = await t.calendar({ action: 'agenda', from: first, to: addDays(first, 6) });
    expect(week.match(/Standup/g)).toHaveLength(5);
    const agenda = await t.calendar({ action: 'agenda', from: today });
    expect(agenda).toContain('Lunch');
    expect(agenda).toContain('task [ ]');
    const free = await t.calendar({ action: 'free_slots', date: today, minutes: 60 });
    expect(free).toContain('14:00–18:00');
  });

  it('deletes one occurrence, or the rest of a series', async () => {
    const t = setup();
    const ev = t.planner.saveEvent({
      title: 'Gym',
      start: '2026-10-05T07:00',
      end: '2026-10-05T08:00',
      recurrence: { freq: 'daily', interval: 1 },
    });
    t.planner.deleteEvent(ev.id, '2026-10-07', 'one');
    expect(t.planner.event(ev.id)?.exdates).toEqual(['2026-10-07']);
    t.planner.deleteEvent(ev.id, '2026-10-10', 'following');
    expect(t.planner.event(ev.id)?.recurrence?.until).toBe('2026-10-09');
    const days = t.planner.agenda('2026-10-01', '2026-10-31', {}).map((a) => a.start.slice(0, 10));
    expect(days).toEqual(['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09']);
  });

  it('reminds before an event once, even across ticks', () => {
    const t = setup();
    t.planner.saveEvent({
      title: 'Dentist',
      start: '2026-10-09T16:00',
      end: '2026-10-09T16:30',
      reminders: [10],
    });
    t.planner.tick(new Date(2026, 9, 9, 15, 49));
    t.planner.tick(new Date(2026, 9, 9, 15, 50, 10));
    t.planner.tick(new Date(2026, 9, 9, 15, 51));
    expect(t.notices().filter((m) => m.includes('Dentist'))).toEqual([
      'Event: Dentist in 10 minutes',
    ]);
  });

  it('exports and imports .ics with repeats, deleted dates and alarms', () => {
    const t = setup();
    t.planner.saveEvent({
      title: 'Team, sync; weekly',
      start: '2026-10-05T10:00',
      end: '2026-10-05T10:30',
      location: 'Room 2',
      recurrence: { freq: 'weekly', interval: 1, byDay: [1, 3], count: 6 },
      exdates: ['2026-10-07'],
      reminders: [15],
    });
    t.planner.saveEvent({
      title: 'Holiday',
      start: '2026-10-20T00:00',
      end: '2026-10-21T00:00',
      allDay: true,
    });
    const ics = t.planner.exportIcs();
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;COUNT=6');
    const back = parseIcs(ics).events;
    expect(back[0]).toMatchObject({
      title: 'Team, sync; weekly',
      start: '2026-10-05T10:00',
      end: '2026-10-05T10:30',
      location: 'Room 2',
      recurrence: { freq: 'weekly', interval: 1, byDay: [1, 3], count: 6 },
      exdates: ['2026-10-07'],
      reminders: [15],
    });
    expect(back[1]).toMatchObject({
      allDay: true,
      start: '2026-10-20T00:00',
      end: '2026-10-21T23:59',
    });
    const { count } = t.planner.importIcs(ics, 'Copy');
    expect(count).toBe(2);
    expect(t.planner.calendars().map((c) => c.name)).toContain('Copy');
  });
});

describe('Planner edge cases (review fixes)', () => {
  it('re-arms the reminder when a timed task moves, and never fires an old one on roll-forward', () => {
    const t = setup();
    const task = t.planner.saveTodo({ title: 'Pay rent', dueDate: '2026-10-01', dueTime: '09:00' });
    t.planner.tick(new Date(2026, 9, 1, 9, 1));
    const moved = t.planner.saveTodo({ id: task.id, dueDate: '2026-10-05' });
    expect(moved.remindAt).toBe('2026-10-05T09:00');
    t.planner.tick(new Date(2026, 9, 5, 9, 1));
    expect(t.notices().filter((m) => m.includes('Pay rent'))).toHaveLength(2);

    // Overdue daily task: the next date is still in the past, so no instant reminder.
    const daily = t.planner.saveTodo({
      title: 'Stretch',
      dueDate: '2020-01-01',
      dueTime: '07:00',
      recurrence: { freq: 'daily', interval: 1 },
    });
    t.planner.saveTodo({ id: daily.id, status: 'done' });
    t.planner.tick();
    expect(t.notices().filter((m) => m.includes('Stretch'))).toHaveLength(0);
  });

  it('reopens subtasks when a repeating task rolls on; Clear completed keeps tasks with open subtasks', () => {
    const t = setup();
    const p = t.planner.saveTodo({
      title: 'Weekly review',
      dueDate: '2026-10-09',
      recurrence: { freq: 'weekly', interval: 1 },
    });
    const sub = t.planner.saveTodo({ title: 'Inbox zero', parentId: p.id });
    t.planner.saveTodo({ id: sub.id, status: 'done' });
    t.planner.saveTodo({ id: p.id, status: 'done' });
    expect(t.planner.todo(sub.id)?.status).toBe('todo');
    expect(() =>
      t.planner.saveTodo({ id: p.id, parentId: t.planner.saveTodo({ title: 'x' }).id }),
    ).toThrow();

    const q = t.planner.saveTodo({ title: 'Ship' });
    const open = t.planner.saveTodo({ title: 'Docs', parentId: q.id });
    t.planner.saveTodo({ id: q.id, status: 'done' });
    t.planner.saveTodo({ id: open.id, status: 'todo' });
    t.planner.clearCompleted();
    expect(t.planner.todo(open.id)).toBeDefined();
  });

  it('reads never create lists, and impossible dates are refused', async () => {
    const t = setup();
    await expect(t.tasks({ action: 'list', list: 'Typo' })).rejects.toThrow(/no list/);
    expect(t.planner.lists()).toHaveLength(0);
    expect(() => t.planner.saveTodo({ title: 'x', dueDate: '2026-02-31' })).toThrow();
  });

  it('skips repeat rules it cannot follow exactly and keeps backslashes intact', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261013T100000',
      'SUMMARY:Second Tuesday',
      'RRULE:FREQ=MONTHLY;BYDAY=2TU',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261013T100000',
      'SUMMARY:Path C:\\new',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const r = parseIcs(ics);
    expect(r.skipped).toBe(1);
    expect(r.events[0]?.title).toBe('Path C:\new');
    const t = setup();
    const before = t.planner.calendars().length;
    expect(() => t.planner.importIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR', 'Empty')).toThrow();
    expect(t.planner.calendars()).toHaveLength(before);
  });
});

describe('Goals (ruflo goals idea)', () => {
  it('a goal lives in the Goals list with its milestones as subtasks, and the list shows progress', async () => {
    const t = setup();
    const tl = t.services.registry.get('goals');
    if (!tl) throw new Error('no goals tool');
    const goals = async (input: unknown): Promise<string> =>
      (await tl.run(tl.input.parse(input), ctx)).content
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('');
    expect(await goals({ action: 'list' })).toBe('No goals yet.');
    const target = addDays(toDateKey(new Date()), 60);
    expect(
      await goals({
        action: 'set',
        title: 'Run a half marathon',
        target,
        milestones: ['Run 5 km', 'Run 10 km', 'Run 15 km'],
      }),
    ).toMatch(/Goal set: Run a half marathon, target .*, 3 milestones/);
    const list = t.planner.lists().find((l) => l.name === 'Goals');
    const goal = t.planner.todos().find((x) => x.title === 'Run a half marathon');
    expect(goal?.listId).toBe(list?.id);
    expect(t.planner.todos().filter((x) => x.parentId === goal?.id)).toHaveLength(3);
    await t.tasks({ action: 'complete', query: 'Run 5 km' });
    expect(await goals({ action: 'list' })).toMatch(
      /Run a half marathon — on track \(1\/3 milestones/,
    );
  });
});
