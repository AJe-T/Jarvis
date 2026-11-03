import { describe, expect, it } from 'vitest';
import {
  freeShare,
  gateFailures,
  niceScale,
  summary,
  weekly,
  weekStart,
  type RunLike,
} from './forge-stats';

const day = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime();

const run = (over: Partial<RunLike>): RunLike => ({
  id: 'forge_x',
  startedAt: day(2026, 11, 3),
  endedAt: day(2026, 11, 3, 13),
  state: 'passed',
  costUsd: 1,
  checks: [],
  freeEdits: 0,
  claudeEdits: 0,
  ship: null,
  ...over,
});

describe('Forge chart numbers (F11)', () => {
  it('weeks start on Monday at midnight', () => {
    // Tue 3 Nov 2026 → Mon 2 Nov; Sun 8 Nov → Mon 2 Nov; Mon 9 Nov → itself.
    expect(weekStart(day(2026, 11, 3))).toBe(new Date(2026, 10, 2).getTime());
    expect(weekStart(day(2026, 11, 8, 23))).toBe(new Date(2026, 10, 2).getTime());
    expect(weekStart(day(2026, 11, 9, 0))).toBe(new Date(2026, 10, 9).getTime());
  });

  it('buckets cost and outcomes by week, empty weeks included, oldest first', () => {
    const now = day(2026, 11, 4);
    const w = weekly(
      [
        run({ costUsd: 1.5 }),
        run({ costUsd: 0.5, state: 'failed' }),
        run({
          costUsd: 2,
          startedAt: day(2026, 10, 21),
          ship: { state: 'shipped', version: '2.40.0' },
        }),
        run({ state: 'cancelled', startedAt: day(2026, 10, 21) }),
        run({ startedAt: day(2025, 1, 1) }), // outside the window
      ],
      4,
      now,
    );
    expect(w).toHaveLength(4);
    expect(w.map((x) => x.start)).toEqual([...w.map((x) => x.start)].sort((a, b) => a - b));
    const last = w.at(-1);
    expect(last).toMatchObject({ cost: 2, passed: 1, failed: 1, cancelled: 0, shipped: 0 });
    const twoAgo = w.at(-3);
    expect(twoAgo).toMatchObject({ cost: 3, passed: 1, cancelled: 1, shipped: 1 });
    expect(w.at(0)?.cost).toBe(0);
  });

  it('counts the first failing check of each failed run, most failures first', () => {
    const g = gateFailures([
      run({
        state: 'failed',
        checks: [
          { id: 'review', ok: true },
          { id: 'lint', ok: false },
        ],
      }),
      run({
        state: 'failed',
        checks: [
          { id: 'review', ok: true },
          { id: 'lint', ok: false },
        ],
      }),
      run({ state: 'failed', checks: [{ id: 'review', ok: false }] }),
      run({
        checks: [
          { id: 'review', ok: true },
          { id: 'lint', ok: true },
          { id: 'unit', ok: true },
        ],
      }),
    ]);
    expect(g).toEqual([
      { id: 'lint', failed: 2, ran: 3 },
      { id: 'review', failed: 1, ran: 4 },
    ]);
  });

  it('free-AI share only for runs that handed edits off, in time order', () => {
    const s = freeShare([
      run({ id: 'b', startedAt: 2, freeEdits: 3, claudeEdits: 1 }),
      run({ id: 'a', startedAt: 1, freeEdits: 0, claudeEdits: 2 }),
      run({ id: 'c', startedAt: 3 }),
    ]);
    expect(s.map((x) => [x.id, x.share])).toEqual([
      ['a', 0],
      ['b', 0.75],
    ]);
  });

  it('summary: pass rate over finished runs, average cost and time', () => {
    expect(summary([])).toEqual({ runs: 0, passRate: null, avgCost: null, avgMinutes: null });
    const s = summary([
      run({ costUsd: 1 }),
      run({ state: 'failed', costUsd: 3 }),
      run({ state: 'building', endedAt: null, costUsd: 2 }),
    ]);
    expect(s.runs).toBe(3);
    expect(s.passRate).toBe(0.5);
    expect(s.avgCost).toBe(2);
    expect(s.avgMinutes).toBe(60);
  });

  it('nice axis scales land on round numbers', () => {
    expect(niceScale(0)).toEqual({ max: 1, step: 0.25 });
    expect(niceScale(7.3)).toEqual({ max: 8, step: 2 });
    expect(niceScale(0.42)).toEqual({ max: 0.6, step: 0.2 });
    expect(niceScale(100)).toEqual({ max: 100, step: 25 });
  });
});
