import { describe, expect, it, vi } from 'vitest';
import { IGNORED_LIMIT, createFollowThrough } from './follow-through';

describe('nudge follow-through', () => {
  it('suggests pausing once after enough unanswered results in a row', () => {
    const onIgnored = vi.fn();
    const f = createFollowThrough(onIgnored);
    // IGNORED_LIMIT + 1 deliveries: each new one finds the previous unanswered.
    for (let i = 0; i <= IGNORED_LIMIT; i++) f.delivered('t1', `c${i}`);
    expect(onIgnored).toHaveBeenCalledOnce();
    expect(onIgnored).toHaveBeenCalledWith('t1');
  });

  it('a reply resets the count, and other tasks count on their own', () => {
    const onIgnored = vi.fn();
    const f = createFollowThrough(onIgnored);
    for (let i = 0; i < IGNORED_LIMIT; i++) f.delivered('t1', `a${i}`);
    f.replied(`a${IGNORED_LIMIT - 1}`);
    f.delivered('t1', 'a-next');
    for (let i = 0; i < IGNORED_LIMIT; i++) f.delivered('t2', `b${i}`);
    f.replied('unrelated');
    expect(onIgnored).not.toHaveBeenCalled();
  });
});
