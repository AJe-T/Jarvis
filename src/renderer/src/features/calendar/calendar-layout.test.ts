import { describe, expect, it } from 'vitest';
import type { CalEvent, Calendar } from '@shared/planner';
import { buildItems, layoutDay, monthGrid } from './calendar-layout';

const cal: Calendar = { id: 'cal_test1', name: 'Personal', color: '#22d3ee', visible: true };
const ev = (id: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: `ev_${id}`,
  calendarId: cal.id,
  title: id,
  notes: '',
  location: '',
  start,
  end,
  allDay: false,
  recurrence: null,
  exdates: [],
  reminders: [],
  createdAt: '',
  updatedAt: '',
  ...extra,
});

describe('calendar layout', () => {
  it('lays overlapping events side by side', () => {
    const items = buildItems(
      [
        ev('a', '2026-10-09T09:00', '2026-10-09T10:00'),
        ev('b', '2026-10-09T09:30', '2026-10-09T11:00'),
        ev('c', '2026-10-09T12:00', '2026-10-09T13:00'),
      ],
      [cal],
      [],
      '2026-10-09',
      '2026-10-09',
      { showTasks: false, query: '' },
    );
    const placed = layoutDay(items, '2026-10-09').map((p) => [p.item.title, p.col, p.cols]);
    expect(placed).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ]);
  });

  it('hides calendars that are switched off and filters by search', () => {
    const items = buildItems(
      [ev('gym', '2026-10-09T07:00', '2026-10-09T08:00')],
      [{ ...cal, visible: false }],
      [],
      '2026-10-09',
      '2026-10-09',
      { showTasks: false, query: '' },
    );
    expect(items).toHaveLength(0);
    const found = buildItems(
      [ev('gym', '2026-10-09T07:00', '2026-10-09T08:00')],
      [cal],
      [],
      '2026-10-09',
      '2026-10-09',
      { showTasks: false, query: 'GY' },
    );
    expect(found).toHaveLength(1);
  });

  it('shows six Monday-first weeks for a month', () => {
    const g = monthGrid('2026-10-15');
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-09-28');
  });
});
