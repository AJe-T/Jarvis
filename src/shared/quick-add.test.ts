import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quick-add';

// Friday 9 October 2026, 17:28.
const NOW = new Date(2026, 9, 9, 17, 28);
const parse = (s: string): ReturnType<typeof parseQuickAdd> => parseQuickAdd(s, NOW);

describe('parseQuickAdd', () => {
  it('reads relative days, times, tags and priority', () => {
    expect(parse('Call mom tomorrow at 6pm #family !1')).toMatchObject({
      title: 'Call mom',
      date: '2026-10-10',
      time: '18:00',
      priority: 1,
      hashtags: ['family'],
    });
    expect(parse('Pay rent today').date).toBe('2026-10-09');
    expect(parse('Plan trip day after tomorrow').date).toBe('2026-10-11');
    expect(parse('Ship it in 3 days').date).toBe('2026-10-12');
    expect(parse('Stretch in 30 min')).toMatchObject({ date: '2026-10-09', time: '17:58' });
  });

  it('reads weekdays, keeps short names in titles unless they follow on/by/next', () => {
    expect(parse('Submit report by monday')).toMatchObject({
      title: 'Submit report',
      date: '2026-10-12',
    });
    expect(parse('Gym next friday').date).toBe('2026-10-16');
    expect(parse('Buy sun cream')).toMatchObject({ title: 'Buy sun cream', date: null });
    expect(parse('Dinner on sat').date).toBe('2026-10-10');
  });

  it('reads written and numeric dates day-first, rolling to next year when passed', () => {
    expect(parse('Dentist 12 oct').date).toBe('2026-10-12');
    expect(parse('Dentist oct 12th').date).toBe('2026-10-12');
    expect(parse('Renew passport 3 march').date).toBe('2027-03-03');
    expect(parse('Tax 15/11').date).toBe('2026-11-15');
    expect(parse('Exam 2026-12-01').date).toBe('2026-12-01');
    expect(parse('Bills on the 1st').date).toBe('2026-11-01');
  });

  it('reads time ranges and lengths for events', () => {
    expect(parse('Lunch with Sam fri 1-2pm')).toMatchObject({
      title: 'Lunch with Sam fri',
      time: '13:00',
      endTime: '14:00',
      durationMin: 60,
    });
    expect(parse('Standup at 9:30 for 15 min')).toMatchObject({
      title: 'Standup',
      time: '09:30',
      durationMin: 15,
      date: '2026-10-10',
    });
    expect(parse('Buy 2-3 apples').title).toBe('Buy 2-3 apples');
  });

  it('reads repeats and starts them on the first matching day', () => {
    expect(parse('Water plants every day').recurrence).toEqual({ freq: 'daily', interval: 1 });
    expect(parse('Review every 2 weeks').recurrence).toEqual({ freq: 'weekly', interval: 2 });
    expect(parse('Standup every weekday 10am')).toMatchObject({
      title: 'Standup',
      recurrence: { freq: 'weekly', interval: 1, byDay: [1, 2, 3, 4, 5] },
      time: '10:00',
    });
    expect(parse('Gym every mon and thu')).toMatchObject({
      title: 'Gym',
      recurrence: { freq: 'weekly', byDay: [1, 4] },
      date: '2026-10-12',
    });
    expect(parse('Backup monthly').recurrence).toEqual({ freq: 'monthly', interval: 1 });
  });
});
