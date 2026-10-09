import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  clock,
  nextPhase,
  pauseTimer,
  remaining,
  startTimer,
  type Timer,
} from './pomodoro';

const fresh: Timer = { phase: 'focus', remainingMs: 25 * 60_000, endsAt: null };

describe('pomodoro timer', () => {
  it('counts down while running and holds while paused', () => {
    const running = startTimer(fresh, 1_000);
    expect(remaining(running, 61_000)).toBe(24 * 60_000);
    const paused = pauseTimer(running, 61_000);
    expect(remaining(paused, 999_999)).toBe(24 * 60_000);
    expect(startTimer(running, 5)).toBe(running);
  });

  it('adds time whether running or paused', () => {
    expect(remaining(addMinutes(fresh, 5), 0)).toBe(30 * 60_000);
    expect(remaining(addMinutes(startTimer(fresh, 0), 5), 0)).toBe(30 * 60_000);
  });

  it('goes focus → running break → paused focus; no break means straight back to focus', () => {
    const brk = nextPhase(fresh, 25, 5, 100);
    expect(brk).toEqual({ phase: 'break', remainingMs: 300_000, endsAt: 300_100 });
    expect(nextPhase(brk, 25, 5, 0)).toEqual(fresh);
    expect(nextPhase(fresh, 25, 0, 0)).toEqual(fresh);
  });

  it('formats mm:ss rounding up partial seconds', () => {
    expect(clock(25 * 60_000)).toBe('25:00');
    expect(clock(1)).toBe('00:01');
    expect(clock(0)).toBe('00:00');
  });
});
