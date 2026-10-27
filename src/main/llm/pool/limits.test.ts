import { describe, expect, it } from 'vitest';
import { createPauses, pauseFor } from './limits';

const H = (h: Record<string, string>): Headers => new Headers(h);

describe('pauseFor: limits learned from a reply', () => {
  it('uses retry-after on a 429, else the 1 → 5 → 30 minute ladder', () => {
    expect(
      pauseFor({ status: 429, headers: H({ 'retry-after': '30' }) }, undefined, 0),
    ).toMatchObject({ until: 30_000, reason: 'rate limited' });
    const first = pauseFor({ status: 429 }, undefined, 0);
    const second = pauseFor({ status: 429 }, first, 0);
    const third = pauseFor({ status: 429 }, second, 0);
    expect([first.until, second.until, third.until]).toEqual([60_000, 300_000, 1_800_000]);
  });

  it('reads a used-up allowance (402, Tavily 432/433, or "credits" in a 429) as a day off', () => {
    for (const status of [402, 432, 433])
      expect(pauseFor({ status }, undefined, 0)).toMatchObject({
        until: 86_400_000,
        reason: 'out of free credit',
      });
    expect(pauseFor({ status: 429, text: 'Monthly credits exceeded' }, undefined, 0).reason).toBe(
      'out of free credit',
    );
    // Pollinations: 402 with a short retry-after is "wait 45 s", not "used up".
    expect(
      pauseFor({ status: 402, headers: H({ 'retry-after': '45' }) }, undefined, 0),
    ).toMatchObject({ until: 45_000, reason: 'busy, try again shortly' });
  });

  it('pauses a rejected key for 6 h and a server error for 2 min', () => {
    expect(pauseFor({ status: 401 }, undefined, 0)).toMatchObject({
      until: 6 * 3_600_000,
      reason: 'key rejected',
    });
    expect(pauseFor({ status: 503 }, undefined, 0)).toMatchObject({
      until: 120_000,
      reason: 'server error 503',
    });
    expect(pauseFor({}, undefined, 0).reason).toBe('unreachable');
  });

  it('a success clears the pause; an expired pause no longer counts', () => {
    let t = 0;
    const p = createPauses(() => t);
    p.fail('tavily', { status: 500 });
    expect(p.active('tavily')?.reason).toBe('server error 500');
    t = 120_001;
    expect(p.active('tavily')).toBeUndefined();
    p.fail('tavily', { status: 500 });
    p.ok('tavily');
    expect(p.active('tavily')).toBeUndefined();
  });
});
