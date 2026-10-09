/** Pomodoro maths, kept apart from the panel so it can be tested without a clock. */
export type Phase = 'focus' | 'break';

export interface Timer {
  phase: Phase;
  /** Remaining milliseconds when paused; when running, derived from endsAt. */
  remainingMs: number;
  endsAt: number | null;
}

export const startTimer = (t: Timer, now: number): Timer =>
  t.endsAt ? t : { ...t, endsAt: now + t.remainingMs };

export const pauseTimer = (t: Timer, now: number): Timer =>
  t.endsAt ? { ...t, remainingMs: Math.max(0, t.endsAt - now), endsAt: null } : t;

export const remaining = (t: Timer, now: number): number =>
  t.endsAt ? Math.max(0, t.endsAt - now) : t.remainingMs;

export const addMinutes = (t: Timer, minutes: number): Timer =>
  t.endsAt
    ? { ...t, endsAt: t.endsAt + minutes * 60_000 }
    : { ...t, remainingMs: t.remainingMs + minutes * 60_000 };

/** When a phase runs out: focus → break (if any, auto-started), break → a fresh, paused focus. */
export function nextPhase(t: Timer, focusMin: number, breakMin: number, now: number): Timer {
  if (t.phase === 'focus' && breakMin > 0)
    return { phase: 'break', remainingMs: breakMin * 60_000, endsAt: now + breakMin * 60_000 };
  return { phase: 'focus', remainingMs: focusMin * 60_000, endsAt: null };
}

export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
