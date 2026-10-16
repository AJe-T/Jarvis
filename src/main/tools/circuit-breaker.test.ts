import { describe, expect, it } from 'vitest';
import { FAILURES_IN_A_ROW, createCircuitBreaker } from './circuit-breaker';

describe('circuit breaker', () => {
  it('refuses the same failing call a third time, but not a changed one', () => {
    const b = createCircuitBreaker();
    const input = { path: 'C:\\missing.txt' };
    for (let i = 0; i < 2; i++) {
      expect(b.check('t1', 'read_file', input).ok).toBe(true);
      b.record('t1', 'read_file', input, true);
    }
    expect(b.check('t1', 'read_file', input)).toMatchObject({ ok: false, reason: 'repeat' });
    expect(b.check('t1', 'read_file', { path: 'C:\\other.txt' }).ok).toBe(true);
    // Another turn starts clean.
    expect(b.check('t2', 'read_file', input).ok).toBe(true);
  });

  it('never counts repeated successful calls (computer-control screenshots)', () => {
    const b = createCircuitBreaker();
    for (let i = 0; i < 50; i++) b.record('t1', 'computer', { action: 'screenshot' }, false);
    expect(b.check('t1', 'computer', { action: 'screenshot' }).ok).toBe(true);
  });

  it('trips for the rest of the turn after too many failures in a row', () => {
    const b = createCircuitBreaker();
    const tripped = Array.from({ length: FAILURES_IN_A_ROW }, (_, i) =>
      b.record('t1', 'fetch_web_page', { url: `https://x.test/${i}` }, true),
    );
    expect(tripped.filter(Boolean)).toHaveLength(1);
    expect(tripped.at(-1)).toBe(true);
    expect(b.check('t1', 'get_weather', {})).toMatchObject({ ok: false, reason: 'tripped' });
  });

  it('a success in between resets the in-a-row count', () => {
    const b = createCircuitBreaker();
    for (let i = 0; i < FAILURES_IN_A_ROW - 1; i++) b.record('t1', 'a', { i }, true);
    b.record('t1', 'b', {}, false);
    expect(b.record('t1', 'a', { i: 99 }, true)).toBe(false);
    expect(b.check('t1', 'c', {}).ok).toBe(true);
  });
});
