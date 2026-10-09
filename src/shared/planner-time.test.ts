import { describe, expect, it } from 'vitest';
import {
  describeRecurrence,
  freeSlots,
  nextDueDate,
  occurrencesBetween,
  recurrenceDates,
  startOfWeek,
} from './planner-time';

const take = (g: Generator<string>, n: number): string[] => {
  const out: string[] = [];
  for (const d of g) {
    out.push(d);
    if (out.length >= n) break;
  }
  return out;
};

describe('recurrence', () => {
  it('weekly on several days, every other week', () => {
    // 2026-10-07 is a Wednesday.
    const r = { freq: 'weekly' as const, interval: 2, byDay: [1, 3] };
    expect(take(recurrenceDates('2026-10-07', r), 4)).toEqual([
      '2026-10-07',
      '2026-10-19',
      '2026-10-21',
      '2026-11-02',
    ]);
  });

  it('skips months without the day and honours count and until', () => {
    const monthly = { freq: 'monthly' as const, interval: 1 };
    expect(take(recurrenceDates('2026-01-31', monthly), 3)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
    expect([...recurrenceDates('2026-10-01', { freq: 'daily', interval: 1, count: 3 })]).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect([...recurrenceDates('2026-10-01', { ...monthly, until: '2026-12-15' })]).toHaveLength(3);
  });

  it('expands occurrences in a window, minus deleted dates, and jumps ahead cheaply', () => {
    const ev = {
      start: '2020-01-01T09:00',
      end: '2020-01-01T10:00',
      recurrence: { freq: 'daily' as const, interval: 1 },
      exdates: ['2026-10-10'],
    };
    expect(occurrencesBetween(ev, '2026-10-09T00:00', '2026-10-11T23:59')).toEqual([
      { start: '2026-10-09T09:00', end: '2026-10-09T10:00', date: '2026-10-09' },
      { start: '2026-10-11T09:00', end: '2026-10-11T10:00', date: '2026-10-11' },
    ]);
  });

  it('rolls a repeating task to its next due date', () => {
    expect(nextDueDate('2026-10-09', { freq: 'weekly', interval: 1, byDay: [1, 5] })).toBe(
      '2026-10-12',
    );
    expect(nextDueDate('2026-10-09', { freq: 'daily', interval: 1, count: 1 })).toBeNull();
  });

  it('describes rules and finds the week start', () => {
    expect(describeRecurrence({ freq: 'weekly', interval: 1, byDay: [5, 1, 2, 3, 4] })).toBe(
      'Every weekday',
    );
    expect(describeRecurrence({ freq: 'monthly', interval: 3 })).toBe('Every 3 months');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
  });
});

describe('freeSlots', () => {
  it('finds gaps long enough between overlapping busy blocks', () => {
    const busy = [
      { start: '2026-10-09T10:00', end: '2026-10-09T11:00' },
      { start: '2026-10-09T10:30', end: '2026-10-09T12:00' },
      { start: '2026-10-09T12:20', end: '2026-10-09T13:00' },
    ];
    expect(freeSlots(busy, '2026-10-09T09:00', '2026-10-09T18:00', 30)).toEqual([
      { start: '2026-10-09T09:00', end: '2026-10-09T10:00' },
      { start: '2026-10-09T13:00', end: '2026-10-09T18:00' },
    ]);
  });
});
