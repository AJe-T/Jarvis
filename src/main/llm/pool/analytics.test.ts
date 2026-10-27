import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../db/connection';
import { buildAnalytics, outlookOf } from './analytics';
import type { RouteState } from './router';

// 12:00 UTC: half of the UTC day has gone.
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

function route(over: Partial<RouteState>): RouteState {
  return {
    key: 'k',
    connectionId: 'conn_groq',
    provider: 'groq',
    model: 'm',
    tier: 2,
    enabled: true,
    order: 0,
    limits: {},
    used: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 },
    stats: { ok: 0, fail: 0, avgMs: 0, tokPerSec: 0 },
    tools: null,
    vision: null,
    lastUsed: 0,
    ...over,
  };
}

describe('pool analytics (Phase 4)', () => {
  it('outlook: plenty, runs out at this pace, about N% left, used up, or no cap', () => {
    const cap = { rpd: 1000 };
    const used = (n: number) => ({ rpm: 0, rpd: n, tpm: 0, tpd: 0 });
    expect(outlookOf([route({ limits: cap })], NOW).text).toBe('plenty left today');
    // 600 of 1000 in 12 hours: 400 left at 50 an hour → 8 hours → 20:00 UTC.
    const soon = outlookOf([route({ limits: cap, used: used(600) })], NOW);
    expect(soon.usedToday).toBeCloseTo(0.6);
    expect(soon.text).toMatch(/^runs out around \d\d:\d\d at this pace$/);
    expect(outlookOf([route({ limits: cap, used: used(200) })], NOW).text).toBe(
      'about 80% left today',
    );
    expect(
      outlookOf(
        [route({ coolingReason: 'out of today’s limit', coolingUntil: NOW + 3_600_000 })],
        NOW,
      ).text,
    ).toMatch(/^used up until /);
    expect(outlookOf([route({})], NOW).usedToday).toBeNull();
  });

  it('totals, buckets, providers and models come from the request log', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const add = (minsAgo: number, ok: number, ms: number, provider = 'groq', model = 'llama') =>
      db
        .prepare(
          `INSERT INTO pool_calls (job, task, at, day, connection_id, provider, model, tier, ok, status, reason, ms, input_tokens, output_tokens)
           VALUES ('j', 't', ?, ?, ?, ?, ?, 2, ?, NULL, NULL, ?, 100, 20)`,
        )
        .run(
          new Date(NOW - minsAgo * 60_000).toISOString(),
          new Date(NOW - minsAgo * 60_000).toISOString().slice(0, 10),
          `conn_${provider}`,
          provider,
          model,
          ok,
          ms,
        );
    add(30, 1, 1000);
    add(90, 1, 3000);
    add(120, 0, 500);
    add(60 * 24 * 3, 1, 2000, 'cerebras', 'gpt-oss');
    const a = buildAnalytics({
      db,
      range: '24h',
      now: NOW,
      routes: [route({})],
      label: (id) => id.toUpperCase(),
      claudeCost: (i, o) => (i + o) / 1000,
    });
    expect(a.buckets).toHaveLength(24);
    expect(a.buckets.reduce((n, b) => n + b.ok + b.fail, 0)).toBe(3);
    expect(a.totals).toMatchObject({
      requests: 3,
      tokensIn: 200,
      tokensOut: 40,
      avgMs: 2000,
      p95Ms: 3000,
      savedUsd: 0.24,
    });
    expect(a.totals.successRate).toBeCloseTo(2 / 3);
    expect(a.providers[0]).toMatchObject({ id: 'groq', label: 'GROQ', requests: 3 });
    const week = buildAnalytics({
      db,
      range: '7d',
      now: NOW,
      routes: [],
      label: (id) => id,
      claudeCost: () => 0,
    });
    expect(week.buckets).toHaveLength(7);
    expect(week.models.map((m) => m.id)).toEqual(['llama', 'gpt-oss']);
  });
});
