import {
  FREE_PROVIDERS,
  type KeyHealth,
  type PoolAnswer,
  type PoolModel,
  type PoolSnapshot,
} from '@shared/free-pool';
import { cloudProvider, type AiConnection, type CloudProviderId } from '@shared/llm-providers';
import type { Db } from '../../db/connection';
import type { SecretStore } from '../../settings/secrets';
import type { SettingsService } from '../../settings/settings-service';
import {
  balancedScore,
  modelMeta,
  rankRoutes,
  reliabilityOf,
  speedOf,
  usedFraction,
  type RouteState,
} from './router';

/** Short provider names for the AI Router page (the catalogue labels carry a description). */
const SHORT: Partial<Record<CloudProviderId, string>> = {
  groq: 'Groq',
  cerebras: 'Cerebras',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA NIM',
};
export const providerName = (id: string): string =>
  SHORT[id as CloudProviderId] ?? cloudProvider(id as CloudProviderId).label;

const SIZE_PCT = { frontier: 100, large: 80, medium: 55, small: 30, unknown: 50 } as const;

/** Builds what the AI Router page shows from the live routes and pool_calls (no text, ever). */
export function buildSnapshot(x: {
  db: Db;
  settings: SettingsService;
  secrets: Pick<SecretStore, 'get'>;
  routes: RouteState[];
  connections: Array<AiConnection & { poolModels: string[] }>;
  health: Map<string, { health: 'healthy' | 'issue'; at: string }>;
  cooling: Map<string, { until: number; reason: string }>;
  now: number;
  claudeCost(input: number, output: number): number;
}): PoolSnapshot {
  const { db, settings, now } = x;
  const day = new Date(now).toISOString().slice(0, 10);
  const month = `${day.slice(0, 7)}-01`;
  const strategy = settings.get('pool.strategy');
  const overrides = settings.get('pool.providers');

  const providers = FREE_PROVIDERS.map((def) => {
    const keys = x.connections
      .filter((c) => c.provider === def.id)
      .map((c) => {
        const mine = x.routes.filter((r) => r.connectionId === c.id);
        const coolNow = mine.some((r) => r.coolingUntil && r.coolingUntil > now);
        const h = x.health.get(c.id);
        const health: KeyHealth =
          h?.health === 'issue' ? 'issue' : coolNow ? 'cooling' : h ? 'healthy' : 'unchecked';
        const requestsToday = (
          db
            .prepare('SELECT COUNT(*) AS n FROM pool_calls WHERE connection_id = ? AND day = ?')
            .get(c.id, day) as { n: number }
        ).n;
        return {
          id: c.id,
          label: c.label,
          hint: (x.secrets.get(c.secret) ?? '').slice(-4),
          health,
          lastChecked: h?.at ?? null,
          usedToday: Math.max(0, ...mine.map(usedFraction)),
          requestsToday,
        };
      });
    return {
      id: def.id,
      label: providerName(def.id),
      tier: overrides[def.id]?.tier ?? def.tier,
      enabled: overrides[def.id]?.enabled ?? true,
      keys,
      docsUrl: def.limitsUrl,
      checked: def.checked,
      note: def.note,
    };
  });

  // Models in the order requests would go right now (every tier, no special needs).
  const order = rankRoutes(
    x.routes,
    { tools: false, vision: false, tiers: [2, 3] },
    strategy === 'priority' ? 'priority' : 'balanced',
    settings.get('pool.keyOrder'),
    now,
  );
  const ordered = [...order.ranked, ...order.skipped.map((s) => s.route)];
  const byModel = new Map<string, RouteState[]>();
  for (const r of ordered) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);

  const monthTokens = new Map(
    (
      db
        .prepare(
          'SELECT model, SUM(input_tokens + output_tokens) AS n FROM pool_calls WHERE day >= ? GROUP BY model',
        )
        .all(month) as Array<{ model: string; n: number }>
    ).map((r) => [r.model, r.n]),
  );

  const models: PoolModel[] = [...byModel.entries()].map(([id, rs]) => {
    const meta = modelMeta(id);
    const stats = rs.reduce(
      (a, r) => ({
        ok: a.ok + r.stats.ok,
        fail: a.fail + r.stats.fail,
        avgMs: a.avgMs || r.stats.avgMs,
        tokPerSec: Math.max(a.tokPerSec, r.stats.tokPerSec),
      }),
      { ok: 0, fail: 0, avgMs: 0, tokPerSec: 0 },
    );
    const measured = stats.ok + stats.fail > 0;
    const daily = rs.map((r) => r.limits.tpd ?? 0).reduce((a, b) => a + b, 0);
    return {
      id,
      label: meta.label,
      maker: meta.maker,
      size: meta.size,
      contextK: 0,
      tools: rs.some((r) => r.tools === true)
        ? true
        : rs.every((r) => r.tools === false)
          ? false
          : null,
      vision: rs.some((r) => r.vision === true)
        ? true
        : rs.every((r) => r.vision === false)
          ? false
          : null,
      monthlyTokens: daily * 30,
      usedTokens: monthTokens.get(id) ?? 0,
      reliability: measured ? Math.round(reliabilityOf(stats) * 100) : 0,
      speed: stats.tokPerSec > 0 ? Math.round(speedOf(stats) * 100) : 0,
      intelligence: SIZE_PCT[meta.size],
      score: measured ? Math.max(...rs.map(balancedScore)) : 0,
      enabled: rs.some((r) => r.enabled),
      routes: rs.map((r) => ({
        providerId: r.provider,
        connectionId: r.connectionId,
        tier: r.tier,
        limits: r.limits,
        usedFraction: usedFraction(r),
        ...(r.coolingUntil && r.coolingUntil > now
          ? {
              coolingUntil: new Date(r.coolingUntil).toISOString(),
              coolingReason: r.coolingReason ?? 'paused',
            }
          : {}),
      })),
    };
  });

  // The last answers, with the failed attempts of the same sub-task as the trail.
  const answers = db
    .prepare(
      'SELECT job, task, at, provider, model, tier, ms, input_tokens + output_tokens AS tokens FROM pool_calls WHERE ok = 1 ORDER BY id DESC LIMIT 10',
    )
    .all() as Array<{
    job: string;
    task: string;
    at: string;
    provider: string;
    model: string;
    tier: 2 | 3;
    ms: number;
    tokens: number;
  }>;
  const recent: PoolAnswer[] = answers.map((a, i) => ({
    id: `${a.job}-${i}`,
    at: a.at,
    task: a.task || 'Sub-task',
    modelLabel: modelMeta(a.model).label,
    providerId: a.provider,
    tier: a.tier,
    tried: (
      db
        .prepare(
          'SELECT provider, reason FROM pool_calls WHERE job = ? AND ok = 0 AND at <= ? ORDER BY id',
        )
        .all(a.job, a.at) as Array<{ provider: string; reason: string | null }>
    ).map((t) => ({ providerId: t.provider, reason: t.reason ?? 'failed' })),
    ms: a.ms,
    tokens: a.tokens,
  }));

  const pressure = x.routes
    .filter((r) => r.coolingUntil && r.coolingUntil > now)
    .map((r) => ({
      providerId: r.provider,
      modelLabel: modelMeta(r.model).label,
      reason: r.coolingReason ?? 'paused',
      until: new Date(r.coolingUntil as number).toISOString(),
    }));

  const t = db
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN ok = 1 THEN job END) AS answers, SUM(ok) AS ok, COUNT(*) AS n,
              SUM(input_tokens) AS input, SUM(output_tokens) AS output FROM pool_calls WHERE day = ?`,
    )
    .get(day) as Record<string, number | null>;

  return {
    preview: false,
    enabled: settings.get('pool.enabled'),
    strategy,
    tier3: settings.get('pool.tier3'),
    keyOrder: settings.get('pool.keyOrder'),
    checkHours: settings.get('pool.checkHours'),
    retryEmpty: settings.get('pool.retryEmpty'),
    providers,
    models,
    recent,
    pressure,
    today: {
      requests: t['answers'] ?? 0,
      successRate: t['n'] ? (t['ok'] ?? 0) / t['n'] : 0,
      tokens: (t['input'] ?? 0) + (t['output'] ?? 0),
      savedUsd: x.claudeCost(t['input'] ?? 0, t['output'] ?? 0),
    },
  };
}
