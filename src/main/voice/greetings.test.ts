import { describe, expect, it } from 'vitest';
import {
  createLinePicker,
  createWorkingLinePicker,
  startupFacts,
  startupLine,
  WAKE_LINES,
  WORKING_LINE_SETS,
  WORKING_LINES,
  workingKind,
} from './greetings';

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

describe('working lines fit the request (v2.62)', () => {
  it('says nothing for chit-chat and "can you hear me"', () => {
    for (const said of [
      'Can you hear me?',
      'Jarvis, are you there?',
      'Hello',
      'Thank you',
      'How are you',
    ])
      expect(workingKind(said), said).toBeNull();
  });

  it('picks a line by what was asked', () => {
    expect(workingKind('What did we decide earlier about the launch?')).toBe('recall');
    expect(workingKind('You mentioned a book yesterday, what was it')).toBe('recall');
    expect(workingKind("What's the weather in Hyderabad")).toBe('lookup');
    expect(workingKind('Could you search for flights to Delhi')).toBe('lookup');
    expect(workingKind('Open my notes and add milk to the list')).toBe('action');
    expect(workingKind('Explain how a transformer model works')).toBe('general');
    expect(workingKind('Note this down for the meeting')).toBe('general'); // not "no"
    expect(workingKind('Good morning, what is on the news today')).toBe('lookup');
    expect(
      workingKind(
        'I want you to go through the whole plan for next month, compare it with what we did in the last quarter and tell me where the gaps are',
      ),
    ).toBe('long');
  });

  it('only uses lines from the matching set', () => {
    const pick = createWorkingLinePicker(() => 0);
    expect(WORKING_LINE_SETS.recall).toContain(pick('what did you say before'));
    expect(pick('can you hear me')).toBeNull();
    expect(WORKING_LINES).toContain(pick('open spotify'));
  });
});
