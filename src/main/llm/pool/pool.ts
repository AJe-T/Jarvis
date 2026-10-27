import {
  FREE_PROVIDERS,
  freeProvider,
  routeKey,
  type PoolLimits,
  type PoolSnapshot,
} from '@shared/free-pool';
import { CLOUD_PROVIDERS, cloudProvider, type CloudProviderId } from '@shared/llm-providers';
import type { Price } from '@shared/settings';
import type { ToolCatalogEntry } from '../../agent/agent-loop';
import type { Db } from '../../db/connection';
import { JarvisError } from '../../errors';
import { redact } from '../../security/redact';
import type { SecretStore } from '../../settings/secrets';
import type { SettingsService } from '../../settings/settings-service';
import type { Connections } from '../connections';
import { createLocalClient } from '../local-client';
import type { LlmClient, LlmMessage, LlmRequest, StreamOptions } from '../types';
import { costOf } from '../usage-ledger';
import { rankRoutes, summarizeExhaustion, type RouteState } from './router';
import { buildSnapshot } from './snapshot';

/**
 * AI Router Phase 1 (Security.md §16.15): the free pool behind the "free" brain. Tries tier-2
 * routes in router order, learns limits and cooldowns from every reply, asks Sir before tier 3,
 * and records every attempt in pool_calls (never the text). Private work is refused before it gets
 * here (agent/brain-runner.ts). Ideas from FreeLLMAPI; our own code.
 */

export type Tier3Answer = 'once' | 'session' | 'no';

export interface PoolDeps {
  db: Db;
  settings: SettingsService;
  secrets: Pick<SecretStore, 'get'>;
  connections: Connections;
  catalog(): ToolCatalogEntry[];
  /** Sir's answer to "Use third-party AIs?" (2 min, then "no"). */
  ask(q: { soonestMin: number | null }): Promise<Tier3Answer>;
  /** Claude's price per token, to show what the pool saved. */
  claudePrice(): Price;
  fetch?: typeof fetch;
  now?: () => number;
}

/** A sub-task's record of what was tried (shown in the reply and on the AI Router page). */
export interface Trail {
  attempts: Array<{ provider: string; model: string; ok: boolean; reason?: string }>;
}

const MAX_ATTEMPTS = 6;
/** No new attempt starts after this long (the first always may). */
const TIME_BUDGET_MS = 45_000;
const ALLOWED = CLOUD_PROVIDERS.map((p) => p.baseUrl);
const KEEP_DAYS = 31;
/** 429 without a hint: 1 min, then 5, then 30. */
const LADDER_MS = [60_000, 300_000, 1_800_000];

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const nextUtcMidnight = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

function needsOf(req: LlmRequest): { tools: boolean; vision: boolean } {
  return {
    tools: (req.tools ?? []).length > 0,
    vision: req.messages.some(
      (m) => typeof m.content !== 'string' && m.content.some((b) => b.type === 'image'),
    ),
  };
}

export function createFreePool(deps: PoolDeps) {
  const { db, settings } = deps;
  const now = (): number => deps.now?.() ?? Date.now();
  const cooling = new Map<string, { until: number; reason: string; strikes: number }>();
  const learnedLimits = new Map<string, PoolLimits>();
  const caps = new Map<string, { tools?: boolean; vision?: boolean }>();
  const health = new Map<string, { health: 'healthy' | 'issue'; at: string }>();
  const lastUsed = new Map<string, number>();
  let tier3ForSession = false;

  db.prepare('DELETE FROM pool_calls WHERE day < ?').run(utcDay(now() - KEEP_DAYS * 86_400_000));

  const providerSettings = (id: string): { enabled: boolean; tier: 2 | 3 } => {
    const o = settings.get('pool.providers')[id] ?? {};
    return { enabled: o.enabled ?? true, tier: o.tier ?? freeProvider(id)?.tier ?? 2 };
  };
  const modelSettings = (model: string): { enabled: boolean; order: number } => {
    const o = settings.get('pool.models')[model] ?? {};
    return { enabled: o.enabled ?? true, order: o.order ?? 1000 };
  };

  /** Keys of free providers that have a key: their main model plus starred ones. */
  function poolConnections() {
    return deps.connections
      .list()
      .filter((c) => c.keySet && freeProvider(c.provider))
      .map((c) => ({
        ...c,
        poolModels: [
          ...new Set([
            ...(c.model ? [c.model] : []),
            ...c.models.filter((m) => m.favourite && m.enabled).map((m) => m.model),
          ]),
        ],
      }));
  }

  const count = (sql: string, ...args: Array<string | number>): number =>
    (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;

  function routes(): RouteState[] {
    const t = now();
    const minuteAgo = new Date(t - 60_000).toISOString();
    const weekAgo = new Date(t - 7 * 86_400_000).toISOString();
    const day = utcDay(t);
    return poolConnections().flatMap((c) => {
      const prov = providerSettings(c.provider);
      const def = freeProvider(c.provider);
      return c.poolModels.map((model): RouteState => {
        const key = routeKey(c.id, model);
        const ms = modelSettings(model);
        const where = 'FROM pool_calls WHERE connection_id = ? AND model = ?';
        const stats = db
          .prepare(
            `SELECT SUM(ok) AS ok, SUM(1 - ok) AS fail, AVG(CASE WHEN ok = 1 THEN ms END) AS ms,
                    SUM(CASE WHEN ok = 1 THEN output_tokens END) AS outTok,
                    SUM(CASE WHEN ok = 1 THEN ms END) AS okMs ${where} AND at >= ?`,
          )
          .get(c.id, model, weekAgo) as Record<string, number | null>;
        // A route pause and a whole-key pause (bad key, server down) can both apply: the later wins.
        const pauses = [cooling.get(key), cooling.get(c.id)].filter((p) => p && p.until > t);
        const cool = pauses.sort((a, b) => (b?.until ?? 0) - (a?.until ?? 0))[0];
        const capsNow = caps.get(key) ?? {};
        return {
          key,
          connectionId: c.id,
          provider: c.provider,
          model,
          tier: prov.tier,
          enabled: prov.enabled && ms.enabled,
          order: ms.order,
          limits: { ...def?.limits, ...learnedLimits.get(c.id) },
          used: {
            rpm: count(`SELECT COUNT(*) AS n ${where} AND at >= ?`, c.id, model, minuteAgo),
            rpd: count(`SELECT COUNT(*) AS n ${where} AND day = ?`, c.id, model, day),
            tpm: count(
              `SELECT SUM(input_tokens + output_tokens) AS n ${where} AND at >= ?`,
              c.id,
              model,
              minuteAgo,
            ),
            tpd: count(
              `SELECT SUM(input_tokens + output_tokens) AS n ${where} AND day = ?`,
              c.id,
              model,
              day,
            ),
          },
          ...(cool && cool.until > t
            ? { coolingUntil: cool.until, coolingReason: cool.reason }
            : {}),
          stats: {
            ok: stats['ok'] ?? 0,
            fail: stats['fail'] ?? 0,
            avgMs: stats['ms'] ?? 0,
            tokPerSec:
              stats['okMs'] && stats['outTok'] ? (stats['outTok'] / stats['okMs']) * 1000 : 0,
          },
          tools: capsNow.tools ?? null,
          vision: capsNow.vision ?? null,
          lastUsed: lastUsed.get(key) ?? 0,
        };
      });
    });
  }

  function record(row: {
    job: string;
    task: string;
    route: RouteState;
    ok: boolean;
    status?: number | undefined;
    reason?: string | undefined;
    ms: number;
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    const t = now();
    lastUsed.set(row.route.key, t);
    db.prepare(
      `INSERT INTO pool_calls (job, task, at, day, connection_id, provider, model, tier, ok, status, reason, ms, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.job,
      row.task.slice(0, 120),
      new Date(t).toISOString(),
      utcDay(t),
      row.route.connectionId,
      row.route.provider,
      row.route.model,
      row.route.tier,
      row.ok ? 1 : 0,
      row.status ?? null,
      row.reason ? redact(row.reason).slice(0, 160) : null,
      Math.round(row.ms),
      row.inputTokens ?? 0,
      row.outputTokens ?? 0,
    );
  }

  /** Groq reports its caps in headers: x-ratelimit-limit-requests = per day, -tokens = per minute. */
  function learnHeaders(connectionId: string, h: Headers): void {
    const rpd = Number(h.get('x-ratelimit-limit-requests'));
    const tpm = Number(h.get('x-ratelimit-limit-tokens'));
    if (rpd > 0 || tpm > 0)
      learnedLimits.set(connectionId, {
        ...learnedLimits.get(connectionId),
        ...(rpd > 0 ? { rpd } : {}),
        ...(tpm > 0 ? { tpm } : {}),
      });
  }

  function cool(key: string, ms: number, reason: string): void {
    const prev = cooling.get(key);
    cooling.set(key, { until: now() + ms, reason, strikes: (prev?.strikes ?? 0) + 1 });
  }

  /** What a failure means for this route: pause it (how long, why) or learn a missing ability. */
  function learnFailure(
    r: RouteState,
    status: number | undefined,
    headers: Headers | undefined,
    text: string,
  ): string {
    const lower = text.toLowerCase();
    if (status === 429) {
      const after = Number(headers?.get('retry-after'));
      if (after > 0) {
        cool(r.key, Math.min(after, 86_400) * 1000, 'rate limited');
        return 'rate limited';
      }
      if (
        headers?.get('x-ratelimit-remaining-requests') === '0' ||
        /per day|daily|\brpd\b|\btpd\b|quota/.test(lower)
      ) {
        cooling.set(r.key, {
          until: nextUtcMidnight(now()),
          reason: 'out of today’s limit',
          strikes: 1,
        });
        return 'out of today’s limit';
      }
      const strikes = cooling.get(r.key)?.strikes ?? 0;
      cool(r.key, LADDER_MS[Math.min(strikes, LADDER_MS.length - 1)] as number, 'rate limited');
      return 'rate limited';
    }
    if (status === 401 || status === 403) {
      cool(r.connectionId, 6 * 3_600_000, 'key rejected');
      health.set(r.connectionId, { health: 'issue', at: new Date(now()).toISOString() });
      return 'key rejected';
    }
    if (status === 402) {
      cool(r.connectionId, 86_400_000, 'out of credit');
      return 'out of credit';
    }
    if (status && status >= 400 && status < 500) {
      if (/tool|function/.test(lower)) {
        caps.set(r.key, { ...caps.get(r.key), tools: false });
        return 'can’t use tools';
      }
      if (/image|vision|multimodal/.test(lower)) {
        caps.set(r.key, { ...caps.get(r.key), vision: false });
        return 'can’t see pictures';
      }
      if (status === 404 || /model/.test(lower)) {
        cool(r.key, 86_400_000, 'model not available');
        return 'model not available';
      }
      cool(r.key, 1_800_000, `refused (${status})`);
      return `refused (${status})`;
    }
    cool(r.connectionId, 120_000, status ? `server error ${status}` : 'unreachable');
    return status ? `server error ${status}` : 'unreachable';
  }

  async function attempt(
    r: RouteState,
    req: LlmRequest,
    opts: StreamOptions,
    job: { id: string; task: string },
    trail: Trail,
  ): Promise<{ msg: LlmMessage } | { streamed: boolean; error: unknown }> {
    const target = deps.connections.target(r.connectionId);
    const p = cloudProvider(r.provider as CloudProviderId);
    let status: number | undefined;
    let headers: Headers | undefined;
    const client = createLocalClient({
      baseUrl: () => p.baseUrl,
      model: () => r.model,
      catalog: deps.catalog,
      apiKey: () => deps.secrets.get(target.secret),
      cloud: { name: () => p.label, allowedBaseUrls: ALLOWED },
      observe: (o) => {
        status = o.status;
        headers = o.headers;
        learnHeaders(r.connectionId, o.headers);
      },
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    let streamed = false;
    const onText = opts.onText;
    const started = now();
    try {
      const msg = await client.stream(req, {
        ...opts,
        ...(onText
          ? {
              onText: (d: string) => {
                streamed = true;
                onText(d);
              },
            }
          : {}),
      });
      const empty = !msg.content.some(
        (b) => (b.type === 'text' && b.text.trim()) || b.type === 'tool_use',
      );
      if (empty && settings.get('pool.retryEmpty')) {
        record({
          job: job.id,
          task: job.task,
          route: r,
          ok: false,
          reason: 'empty answer',
          ms: now() - started,
        });
        trail.attempts.push({
          provider: r.provider,
          model: r.model,
          ok: false,
          reason: 'empty answer',
        });
        return { streamed, error: new Error('empty answer') };
      }
      if (req.tools?.length && msg.content.some((b) => b.type === 'tool_use'))
        caps.set(r.key, { ...caps.get(r.key), tools: true });
      record({
        job: job.id,
        task: job.task,
        route: r,
        ok: true,
        ms: now() - started,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
      });
      health.set(r.connectionId, { health: 'healthy', at: new Date(now()).toISOString() });
      cooling.delete(r.key); // a good answer resets the 429 ladder
      trail.attempts.push({ provider: r.provider, model: r.model, ok: true });
      // "pool_" ids are free in the usage ledger (source "pool").
      return { msg: { ...msg, id: `pool_${r.connectionId}_${now()}` } };
    } catch (error) {
      if (opts.signal.aborted) throw error;
      const text =
        error instanceof Error
          ? `${error.message} ${(error as JarvisError).userMessage ?? ''}`
          : String(error);
      const reason = learnFailure(r, status, headers, text);
      record({
        job: job.id,
        task: job.task,
        route: r,
        ok: false,
        status,
        reason,
        ms: now() - started,
      });
      trail.attempts.push({ provider: r.provider, model: r.model, ok: false, reason });
      return { streamed, error };
    }
  }

  /** One sub-task's client: tries tier 2, then (with Sir's yes) tier 3; records its trail. */
  function session(job: { id: string; task: string }): LlmClient & { trail: Trail } {
    const trail: Trail = { attempts: [] };
    return {
      trail,
      ping: async () => undefined,
      async stream(req, opts) {
        const started = now();
        let failed = 0;
        let tried = 0;
        let lastSkipped: ReturnType<typeof rankRoutes>['skipped'] = [];
        // Phase 1 runs Priority and Balanced; later strategies fall back to Balanced.
        const live = settings.get('pool.strategy') === 'priority' ? 'priority' : 'balanced';
        for (const tier of [2, 3] as const) {
          const all = routes();
          const { ranked, skipped } = rankRoutes(
            all,
            { ...needsOf(req), tiers: [tier] },
            live,
            settings.get('pool.keyOrder'),
            now(),
          );
          if (tier === 3) {
            if (settings.get('pool.tier3') === 'never') break;
            // Only ask when a third-party route could actually take this request.
            if (ranked.length === 0) break;
            if (!tier3ForSession) {
              const soon = lastSkipped
                .map((s) => s.route.coolingUntil ?? 0)
                .filter((x) => x > now())
                .sort((a, b) => a - b)[0];
              const answer = await deps.ask({
                soonestMin: soon ? Math.max(1, Math.round((soon - now()) / 60_000)) : null,
              });
              if (answer === 'no') break;
              if (answer === 'session') tier3ForSession = true;
            }
          }
          lastSkipped = [...lastSkipped, ...skipped.filter((s) => s.why !== 'tier')];
          for (const r of ranked) {
            if (tried >= MAX_ATTEMPTS || (tried > 0 && now() - started > TIME_BUDGET_MS)) break;
            tried += 1;
            const res = await attempt(r, req, opts, job, trail);
            if ('msg' in res) return res.msg;
            failed += 1;
            // Text already on screen is never mixed with another model's answer.
            if (res.streamed) throw res.error;
          }
        }
        throw new JarvisError(
          'LLM_OVERLOADED',
          'free pool exhausted',
          `${summarizeExhaustion(lastSkipped, failed, now())} Claude can do this one instead.`,
        );
      },
    };
  }

  return {
    session,
    routes,
    /** Ready = switched on and at least one tier-2 route set up. */
    ready: (): boolean =>
      settings.get('pool.enabled') && routes().some((r) => r.tier === 2 && r.enabled),
    snapshot: (): PoolSnapshot =>
      buildSnapshot({
        db,
        settings,
        secrets: deps.secrets,
        routes: routes(),
        connections: poolConnections(),
        health,
        cooling,
        now: now(),
        claudeCost: (input, output) =>
          costOf(deps.claudePrice(), { input, output, cacheRead: 0, cacheWrite: 0 }),
      }),
    /** Key check: one model-list call per key (no tokens used). */
    async checkKeys(): Promise<void> {
      await Promise.all(
        poolConnections().map(async (c) => {
          const p = cloudProvider(c.provider);
          const client = createLocalClient({
            baseUrl: () => p.baseUrl,
            model: () => c.model,
            catalog: deps.catalog,
            apiKey: () => deps.secrets.get(c.secret),
            cloud: {
              name: () => p.label,
              allowedBaseUrls: ALLOWED,
              listing: () => ({ kind: p.models }),
            },
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
          });
          const at = new Date(now()).toISOString();
          try {
            if (p.models === 'manual') await client.ping(c.model, AbortSignal.timeout(20_000));
            else await client.listModels();
            health.set(c.id, { health: 'healthy', at });
            if (cooling.get(c.id)?.reason === 'key rejected') cooling.delete(c.id);
          } catch (err) {
            const auth = err instanceof JarvisError && err.code === 'LLM_AUTH';
            health.set(c.id, { health: auth ? 'issue' : 'healthy', at });
          }
        }),
      );
    },
    /** Forget pauses (Sir fixed a key, or wants to retry now). */
    clearCooldowns: (): void => cooling.clear(),
    providers: FREE_PROVIDERS,
  };
}

export type FreePool = ReturnType<typeof createFreePool>;
