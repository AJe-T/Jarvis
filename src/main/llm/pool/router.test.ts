import { describe, expect, it } from 'vitest';
import {
  headroomFactor,
  modelMeta,
  rankRoutes,
  summarizeExhaustion,
  usedFraction,
  type RouteState,
} from './router';

const NOW = 1_800_000_000_000;

function route(over: Partial<RouteState> & { key: string }): RouteState {
  return {
    connectionId: `conn_${over.key}`,
    provider: over.key,
    model: 'llama-3.3-70b',
    tier: 2,
    enabled: true,
    order: 1000,
    limits: {},
    used: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 },
    stats: { ok: 0, fail: 0, avgMs: 0, tokPerSec: 0 },
    tools: null,
    vision: null,
    lastUsed: 0,
    ...over,
  };
}

const ALL = { tools: false, vision: false, tiers: [2, 3] as const };

describe('free pool router', () => {
  it('skips routes that are off, paused, over a cap or missing a needed ability', () => {
    const { ranked, skipped } = rankRoutes(
      [
        route({ key: 'off', enabled: false }),
        route({ key: 'paused', coolingUntil: NOW + 60_000 }),
        route({ key: 'rpm', limits: { rpm: 5 }, used: { rpm: 5, rpd: 0, tpm: 0, tpd: 0 } }),
        route({ key: 'rpd', limits: { rpd: 50 }, used: { rpm: 0, rpd: 50, tpm: 0, tpd: 0 } }),
        route({ key: 'notools', tools: false }),
        route({ key: 'ok' }),
        route({ key: 'cooled', coolingUntil: NOW - 1 }),
      ],
      { ...ALL, tools: true },
      'balanced',
      'roomiest',
      NOW,
    );
    expect(ranked.map((r) => r.key).sort()).toEqual(['cooled', 'ok']);
    expect(Object.fromEntries(skipped.map((s) => [s.route.key, s.why]))).toEqual({
      off: 'off',
      paused: 'cooling',
      rpm: 'rpm',
      rpd: 'rpd',
      notools: 'tools',
    });
  });

  it('never offers tier 3 unless it is asked for', () => {
    const r = rankRoutes(
      [route({ key: 'relay', tier: 3 })],
      { ...ALL, tiers: [2] },
      'balanced',
      'roomiest',
      NOW,
    );
    expect(r.ranked).toHaveLength(0);
    expect(r.skipped[0]?.why).toBe('tier');
  });

  it('Priority follows Sir’s order; Balanced prefers the route that answers reliably', () => {
    const flaky = route({
      key: 'flaky',
      order: 0,
      stats: { ok: 1, fail: 9, avgMs: 900, tokPerSec: 80 },
    });
    const steady = route({
      key: 'steady',
      order: 1,
      stats: { ok: 40, fail: 0, avgMs: 900, tokPerSec: 80 },
    });
    expect(rankRoutes([steady, flaky], ALL, 'priority', 'roomiest', NOW).ranked[0]?.key).toBe(
      'flaky',
    );
    expect(rankRoutes([flaky, steady], ALL, 'balanced', 'roomiest', NOW).ranked[0]?.key).toBe(
      'steady',
    );
  });

  it('with two keys for the same model, the one with more room goes first', () => {
    const full = route({
      key: 'a',
      order: 0,
      limits: { rpd: 100 },
      used: { rpm: 0, rpd: 90, tpm: 0, tpd: 0 },
    });
    const roomy = route({
      key: 'b',
      order: 0,
      limits: { rpd: 100 },
      used: { rpm: 0, rpd: 10, tpm: 0, tpd: 0 },
    });
    expect(rankRoutes([full, roomy], ALL, 'priority', 'roomiest', NOW).ranked[0]?.key).toBe('b');
    const recent = { ...roomy, lastUsed: NOW - 1 };
    const rested = { ...full, lastUsed: NOW - 60_000 };
    expect(rankRoutes([recent, rested], ALL, 'priority', 'turns', NOW).ranked[0]?.key).toBe('a');
  });

  it('measures the tightest cap and shrinks a nearly full route’s score', () => {
    expect(
      usedFraction({ limits: { rpm: 10, rpd: 100 }, used: { rpm: 2, rpd: 90, tpm: 0, tpd: 0 } }),
    ).toBe(0.9);
    expect(usedFraction({ limits: {}, used: { rpm: 99, rpd: 99, tpm: 0, tpd: 0 } })).toBe(0);
    expect(headroomFactor(0.5)).toBe(1);
    expect(headroomFactor(1)).toBeCloseTo(0.1);
  });

  it('explains plainly why nothing could answer and when the soonest route is back', () => {
    const text = summarizeExhaustion(
      [
        { route: route({ key: 'a', coolingUntil: NOW + 120_000 }), why: 'cooling' },
        { route: route({ key: 'b' }), why: 'rpd' },
      ],
      1,
      NOW,
    );
    expect(text).toBe(
      'All free AIs are busy: 3 routes checked (1 rate limited or paused, 1 out of today’s limit, 1 failed just now). Soonest back in about 2 min.',
    );
    expect(summarizeExhaustion([], 0, NOW)).toMatch(/No free AI is set up yet/);
  });

  it('reads a readable name, maker and size out of a provider’s model id', () => {
    expect(modelMeta('openai/gpt-oss-120b')).toEqual({
      label: 'Gpt Oss 120B',
      maker: 'OpenAI',
      size: 'large',
    });
    expect(modelMeta('meta-llama/llama-3.1-8b-instruct:free').size).toBe('small');
    expect(modelMeta('gemini-2.5-flash')).toMatchObject({ maker: 'Google', size: 'large' });
    expect(modelMeta('deepseek-v3-671b').size).toBe('frontier');
  });
});

describe('Phase 4 strategies', () => {
  // Three routes, each best at one thing.
  const big = route({
    key: 'big',
    model: 'deepseek-v3.1-671b',
    stats: { ok: 6, fail: 4, avgMs: 4000, tokPerSec: 15 },
  });
  const fast = route({
    key: 'fast',
    model: 'llama-3.1-8b-instant',
    stats: { ok: 6, fail: 4, avgMs: 300, tokPerSec: 400 },
  });
  const steady = route({
    key: 'steady',
    model: 'gemma-3-27b',
    stats: { ok: 60, fail: 0, avgMs: 2000, tokPerSec: 30 },
  });
  const first = (
    strategy: Parameters<typeof rankRoutes>[2],
    w?: Parameters<typeof rankRoutes>[5],
  ) => rankRoutes([big, fast, steady], ALL, strategy, 'roomiest', NOW, w).ranked[0]?.key;

  it('Smartest, Fastest and Most reliable each put their own kind first', () => {
    expect(first('smartest')).toBe('big');
    expect(first('fastest')).toBe('fast');
    expect(first('reliable')).toBe('steady');
  });

  it('Custom ranks by Sir’s own weights', () => {
    expect(first('custom', { reliability: 0, speed: 1, smarts: 0 })).toBe('fast');
    expect(first('custom', { reliability: 0, speed: 0, smarts: 1 })).toBe('big');
  });

  it('skips a model whose known context is smaller than the request', () => {
    const small = route({ key: 'small', context: 8192 });
    const roomy = route({ key: 'roomy', context: 131072 });
    const unknown = route({ key: 'unknown' });
    const r = rankRoutes(
      [small, roomy, unknown],
      { ...ALL, tokens: 20_000 },
      'balanced',
      'roomiest',
      NOW,
    );
    expect(r.ranked.map((x) => x.key).sort()).toEqual(['roomy', 'unknown']);
    expect(r.skipped).toEqual([{ route: small, why: 'context' }]);
  });
});
