import { describe, expect, it } from 'vitest';
import { awayReport } from './watchdog';

describe('automation watchdog report', () => {
  it('says nothing when nothing was held back', () => {
    expect(awayReport('Morning briefing', undefined)).toBeNull();
    expect(awayReport('Morning briefing', { blocked: [], unanswered: [] })).toBeNull();
  });

  it('names the injection, blocked and unanswered actions', () => {
    expect(
      awayReport('Bills', {
        injection: 'web:fetch_web_page, which tells the AI to ignore its instructions',
        blocked: ['Run a script'],
        unanswered: ['Open evil.example'],
      }),
    ).toBe(
      'While running "Bills", it read web:fetch_web_page, which tells the AI to ignore its instructions; the safety policy blocked: Run a script; these waited for your OK and were not done: Open evil.example.',
    );
  });

  it('shortens long lists', () => {
    expect(awayReport('X', { blocked: ['a', 'b', 'c', 'd', 'e'], unanswered: [] })).toBe(
      'While running "X", the safety policy blocked: a, b, c and 2 more.',
    );
  });
});
