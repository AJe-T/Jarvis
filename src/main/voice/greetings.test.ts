import { describe, expect, it } from 'vitest';
import { createLinePicker, startupFacts, startupLine, WAKE_LINES } from './greetings';

describe('createLinePicker', () => {
  it('never repeats the previous line', () => {
    const pick = createLinePicker(WAKE_LINES, () => 0);
    const said = [pick(), pick(), pick()];
    expect(said[0]).not.toBe(said[1]);
    expect(said[1]).not.toBe(said[2]);
  });

  it('returns only lines from the list', () => {
    const pick = createLinePicker(['a', 'b']);
    for (let i = 0; i < 20; i++) expect(['a', 'b']).toContain(pick());
  });
});

describe('startup hello', () => {
  const at = new Date(2026, 9, 17, 9, 5);
  it('greets by time of day with the plan, and ends with a question (the mic opens next)', () => {
    const line = startupLine({
      now: at,
      events: [
        { title: 'Design review', start: '2026-10-17T15:00', allDay: false },
        { title: 'Standup', start: '2026-10-17T10:00', allDay: false },
      ],
      tasksDue: 1,
      overdue: 2,
    });
    expect(line).toMatch(/^Good morning, sir\. It's 9:05/);
    expect(line).toContain('You have 2 events today, starting with Standup at 10:00.');
    expect(line).toContain('One task due, and 2 overdue.');
    expect(line).toMatch(/\?$/);
  });

  it('says the day is clear when nothing is planned', () => {
    expect(
      startupLine({ now: new Date(2026, 9, 17, 22, 0), events: [], tasksDue: 0, overdue: 0 }),
    ).toMatch(/^Good evening, sir\. .* Your day is clear\. What shall we do\?$/);
  });

  it('reads today from the planner: events not over yet, open top-level tasks only', () => {
    const facts = startupFacts(
      {
        agenda: () => [
          {
            kind: 'event',
            id: 'a',
            title: 'Gone',
            start: '2026-10-17T08:00',
            end: '2026-10-17T08:30',
            allDay: false,
            where: '',
            done: false,
          },
          {
            kind: 'event',
            id: 'b',
            title: 'Later',
            start: '2026-10-17T11:00',
            end: null,
            allDay: false,
            where: '',
            done: false,
          },
          {
            kind: 'task',
            id: 'c',
            title: 'Task',
            start: '2026-10-17',
            end: null,
            allDay: true,
            where: '',
            done: false,
          },
        ],
        todos: () => [
          { dueDate: '2026-10-17', status: 'todo', parentId: null },
          { dueDate: '2026-10-15', status: 'todo', parentId: null },
          { dueDate: '2026-10-15', status: 'done', parentId: null },
          { dueDate: '2026-10-17', status: 'todo', parentId: 'p' },
          { dueDate: null, status: 'todo', parentId: null },
        ],
      },
      at,
    );
    expect(facts.events.map((e) => e.title)).toEqual(['Later']);
    expect(facts.tasksDue).toBe(1);
    expect(facts.overdue).toBe(1);
  });
});
