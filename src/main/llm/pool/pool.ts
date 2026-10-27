import {
  FREE_PROVIDERS,
  freeProvider,
  isCustomProvider,
  isFreeChatModel,
  routeKey,
  type AnalyticsRange,
  type PoolAbilities,
  type PoolAnalytics,
  type PoolLimits,
  type PoolSnapshot,
} from '@shared/free-pool';
import {
  CLOUD_PROVIDERS,
  cloudProvider,
  providerBaseUrl,
  type CloudProviderId,
  type ModelListing,
} from '@shared/llm-providers';
import type { Price } from '@shared/settings';
import type { ToolCatalogEntry } from '../../agent/agent-loop';
import type { Db } from '../../db/connection';
import { JarvisError } from '../../errors';
import { redact } from '../../security/redact';
import type { SecretStore } from '../../settings/secrets';
import type { SettingsService } from '../../settings/settings-service';
import type { Connections } from '../connections';
import { cloudBaseUrl, createLocalClient } from '../local-client';
import type { LlmClient, LlmMessage, LlmRequest, StreamOptions } from '../types';
import { costOf } from '../usage-ledger';
import {
  checkCustom,
  guardedFetch,
  type CustomInput,
  type CustomProviders,
  type Lookup,
} from './custom';
import { rankRoutes, summarizeExhaustion, type RouteState } from './router';
import { buildSnapshot, providerName } from './snapshot';
import { estimateTokens, shrinkRequest } from './shrink';
import { buildAnalytics } from './analytics';

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
  /** Sir's own providers, always tier 3 (custom.ts). */
  custom: CustomProviders;
  catalog(): ToolCatalogEntry[];
  /** Sir's answer to "Use third-party AIs?" (2 min, then "no"); `everyTime` hides "until restart". */
  ask(q: { soonestMin: number | null; everyTime: boolean }): Promise<Tier3Answer>;
  /** Claude's price per token, to show what the pool saved. */
  claudePrice(): Price;
  fetch?: typeof fetch;
  /** Phase 3 abilities for the page (search keys, image makers, fusion line-up, voice engines). */
  abilities?(): Omit<PoolAbilities, 'fusion' | 'settings'>;
  /** Tests: DNS answers for custom providers' hosts. */
  lookup?: Lookup;
  now?: () => number;
}

/** A sub-task's record of what was tried (shown in the reply and on the AI Router page). */
export interface Trail {
  attempts: Array<{
    provider: string;
    /** Display name (a custom provider's is Sir's own). */
    name: string;
    model: string;
    tier: 2 | 3;
    ok: boolean;
    reason?: string;
  }>;
}

/** Where one route's requests go and how (built-in catalogue address, or Sir's own). */
interface Target {
  name: string;
  baseUrl: string;
  allowed: readonly string[];
  key: string | undefined;
  listing: ModelListing;
  custom: boolean;
}

/** Tier 3 is told only that it answers a question: no persona, nothing about Sir. */
const TIER3_SYSTEM = 'Answer the question clearly and briefly.';

/**
 * Security.md §16.15: a tier-3 route gets the task itself and nothing else: no system prompt, no
 * earlier turns or tool results, no pictures, no tools. The task is the newest user message with
 * text: a sub-task's only one (brain-runner.ts, Compare AIs), or a chat's current question
 * (front-door.ts; tool results are not text).
 */
export function questionOnly(req: LlmRequest): LlmRequest {
  const textOf = (m: LlmRequest['messages'][number]): string =>
    typeof m.content === 'string'
      ? m.content
      : m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
  const text =
    req.messages
      .filter((m) => m.role === 'user')
      .map(textOf)
      .findLast((x) => x.trim() !== '') ?? '';
  return {
    model: req.model,
    max_tokens: req.max_tokens,
    system: TIER3_SYSTEM,
    messages: [{ role: 'user', content: text }],
  };
}

/** A tier-3 answer is text only: a tool call it made up anyway is dropped. */
function answerOnly(msg: LlmMessage): LlmMessage {
  return {
    ...msg,
    content: msg.content.filter((b) => b.type !== 'tool_use'),
    stop_reason: msg.stop_reason === 'tool_use' ? 'end_turn' : msg.stop_reason,
  };
}

/** A conversation keeps the pool model that last answered it this long (pool.delegation.sticky). */
export const STICKY_MS = 30 * 60_000;

/** The pool's "every route tried" error: Claude may take the job instead (pool.delegation.fallback). */
export const isPoolExhausted = (err: unknown): boolean =>
  err instanceof JarvisError && err.message === 'free pool exhausted';

export interface PoolJob {
  id: string;
  task: string;
  /** Tiers to try (default 2 then 3); the front door uses tier 2 only. */
  tiers?: ReadonlyArray<2 | 3>;
  /** Conversation id: the model that last answered it is tried first, for 30 minutes. */
  sticky?: string;
  /** What a different model gets than the one that answered this conversation before. */
  handover?: (req: LlmRequest) => LlmRequest;
  /** Fusion: narrows or reorders the ranked routes (one provider per drafter, the judge's pick). */
  pick?: (ranked: RouteState[]) => RouteState[];
  /** Phase 4: a named chain (`pool.chains`): its models go first, in its order. */
  chain?: string;
}

/** Days of request records kept (Analytics shows up to 90). */
export const KEEP_DAYS = 92;
/** Learned scores: a day's results count half as much every this many days. */
const HALF_LIFE_DAYS = 2;

const MAX_ATTEMPTS = 6;
/** No new attempt starts after this long (the first always may). */
const TIME_BUDGET_MS = 45_000;
const ALLOWED = CLOUD_PROVIDERS.map((p) => p.baseUrl);
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
  /** Conversation id → the route that last answered it (expires STICKY_MS after that answer). */
  const lastRoute = new Map<string, { key: string; until: number }>();

  db.prepare('DELETE FROM pool_calls WHERE day < ?').run(utcDay(now() - KEEP_DAYS * 86_400_000));

  const providerSettings = (id: string): { enabled: boolean; tier: 2 | 3 } => {
    const o = settings.get('pool.providers')[id] ?? {};
    // Sir's own providers are tier 3 whatever a setting says.
    const tier = isCustomProvider(id) ? 3 : (o.tier ?? freeProvider(id)?.tier ?? 2);
    return { enabled: o.enabled ?? true, tier };
  };
  const modelSettings = (model: string): { enabled: boolean; order: number } => {
    const o = settings.get('pool.models')[model] ?? {};
    return { enabled: o.enabled ?? true, order: o.order ?? 1000 };
  };

  /**
   * Keys of free providers that have a key: their main model plus starred ones. A key with nothing
   * chosen or starred joins with every free chat model its model list shows (2.33.1), so adding a
   * key is enough; Sir switches models off on the Models tab.
   */
  function poolConnections() {
    return deps.connections
      .list()
      .filter((c) => c.keySet && freeProvider(c.provider))
      .map((c) => {
        const chosen = [
          ...(c.model ? [c.model] : []),
          ...c.models.filter((m) => m.favourite && m.enabled).map((m) => m.model),
        ];
        const listed = chosen.length
          ? []
          : c.models
              .filter(
                (m) => m.enabled && m.source === 'live' && isFreeChatModel(c.provider, m.model),
              )
              .map((m) => m.model);
        return { ...c, poolModels: [...new Set([...chosen, ...listed])] };
      });
  }

  const count = (sql: string, ...args: Array<string | number>): number =>
    (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;

  /** Every (key, model) pair the pool may ask: the free providers' keys, then Sir's own providers. */
  function seats(): Array<{
    connectionId: string;
    provider: string;
    model: string;
    tier: 2 | 3;
    enabled: boolean;
    limits: PoolLimits;
    context?: number | undefined;
  }> {
    const account = settings.get('llm.cloud.cloudflareAccount');
    const builtIn = poolConnections()
      // Cloudflare's address needs Sir's Account ID first.
      .filter((c) => providerBaseUrl(cloudProvider(c.provider), account) !== '')
      .flatMap((c) => {
        const prov = providerSettings(c.provider);
        return c.poolModels.map((model) => ({
          connectionId: c.id,
          provider: c.provider,
          model,
          context: c.models.find((m) => m.model === model)?.context ?? undefined,
          // Groq reports its caps per model, so learned limits are kept per route.
          limits: {
            ...freeProvider(c.provider)?.limits,
            ...learnedLimits.get(c.id),
            ...learnedLimits.get(routeKey(c.id, model)),
          },
          ...prov,
        }));
      });
    const mine = deps.custom.list().map((c) => ({
      connectionId: c.id,
      provider: c.id,
      model: c.model,
      limits: { ...learnedLimits.get(c.id) },
      ...providerSettings(c.id),
    }));
    return [...builtIn, ...mine];
  }

  function routes(): RouteState[] {
    const t = now();
    const minuteAgo = new Date(t - 60_000).toISOString();
    const weekAgo = new Date(t - 7 * 86_400_000).toISOString();
    const day = utcDay(t);
    return seats().map((s): RouteState => {
      const { connectionId: id, model } = s;
      const key = routeKey(id, model);
      const ms = modelSettings(model);
      const where = 'FROM pool_calls WHERE connection_id = ? AND model = ?';
      const stats = weekStats(id, model, weekAgo, t);
      // A route pause and a whole-key pause (bad key, server down) can both apply: the later wins.
      const pauses = [cooling.get(key), cooling.get(id)].filter((p) => p && p.until > t);
      const cool = pauses.sort((a, b) => (b?.until ?? 0) - (a?.until ?? 0))[0];
      const capsNow = caps.get(key) ?? {};
      return {
        key,
        connectionId: id,
        provider: s.provider,
        model,
        tier: s.tier,
        enabled: s.enabled && ms.enabled,
        order: ms.order,
        limits: s.limits,
        used: {
          rpm: count(`SELECT COUNT(*) AS n ${where} AND at >= ?`, id, model, minuteAgo),
          rpd: count(`SELECT COUNT(*) AS n ${where} AND day = ?`, id, model, day),
          tpm: count(
            `SELECT SUM(input_tokens + output_tokens) AS n ${where} AND at >= ?`,
            id,
            model,
            minuteAgo,
          ),
          tpd: count(
            `SELECT SUM(input_tokens + output_tokens) AS n ${where} AND day = ?`,
            id,
            model,
            day,
          ),
        },
        ...(cool && cool.until > t ? { coolingUntil: cool.until, coolingReason: cool.reason } : {}),
        stats,
        tools: capsNow.tools ?? null,
        vision: capsNow.vision ?? null,
        lastUsed: lastUsed.get(key) ?? 0,
        ...(s.context ? { context: s.context } : {}),
      };
    });
  }

  /**
   * The last week of one route's results. With `pool.learn` (Phase 4) each day counts half as
   * much every two days, so a model that got better (or worse) moves in the ranking quickly.
   */
  function weekStats(id: string, model: string, since: string, t: number): RouteState['stats'] {
    const rows = db
      .prepare(
        `SELECT day, SUM(ok) AS ok, SUM(1 - ok) AS fail, SUM(CASE WHEN ok = 1 THEN ms END) AS okMs,
                SUM(CASE WHEN ok = 1 THEN output_tokens END) AS outTok
         FROM pool_calls WHERE connection_id = ? AND model = ? AND at >= ? GROUP BY day`,
      )
      .all(id, model, since) as Array<{
      day: string;
      ok: number;
      fail: number;
      okMs: number | null;
      outTok: number | null;
    }>;
    const learn = settings.get('pool.learn');
    const today = Date.parse(utcDay(t));
    const s = { ok: 0, fail: 0, okMs: 0, outTok: 0 };
    for (const r of rows) {
      const age = (today - Date.parse(r.day)) / 86_400_000;
      const w = learn ? 0.5 ** (age / HALF_LIFE_DAYS) : 1;
      s.ok += w * r.ok;
      s.fail += w * r.fail;
      s.okMs += w * (r.okMs ?? 0);
      s.outTok += w * (r.outTok ?? 0);
    }
    return {
      ok: s.ok,
      fail: s.fail,
      avgMs: s.ok ? s.okMs / s.ok : 0,
      tokPerSec: s.okMs && s.outTok ? (s.outTok / s.okMs) * 1000 : 0,
    };
  }

  /** A named chain's models first, in its order; every other route after them, as ranked. */
  function byChain(ranked: RouteState[], name: string | undefined): RouteState[] {
    if (!name) return ranked;
    const chain = settings
      .get('pool.chains')
      .find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (!chain) return ranked;
    const first = chain.models.flatMap((m) => ranked.filter((r) => r.model === m));
    return [...first, ...ranked.filter((r) => !chain.models.includes(r.model))];
  }

  /** Where a route (or key) sends its requests: a catalogue address or one of Sir's own. */
  function targetOf(connectionId: string, provider: string): Target {
    if (isCustomProvider(provider)) {
      const c = deps.custom.find(connectionId);
      if (!c)
        throw new JarvisError(
          'NOT_FOUND',
          `no custom provider ${connectionId}`,
          'That provider was removed.',
        );
      return {
        name: c.name,
        baseUrl: c.baseUrl,
        allowed: [c.baseUrl],
        key: deps.secrets.get(c.secret),
        listing: 'manual',
        custom: true,
      };
    }
    const p = cloudProvider(provider as CloudProviderId);
    return {
      name: p.label,
      baseUrl: cloudBaseUrl(p, settings.get('llm.cloud.cloudflareAccount')),
      allowed: ALLOWED,
      key: deps.secrets.get(deps.connections.target(connectionId).secret),
      listing: p.models,
      custom: false,
    };
  }

  const baseFetch = (): typeof fetch => deps.fetch ?? fetch;

  function clientFor(
    t: Target,
    model: string,
    observe?: (o: { status: number; headers: Headers }) => void,
  ) {
    return createLocalClient({
      baseUrl: () => t.baseUrl,
      model: () => model,
      catalog: deps.catalog,
      apiKey: () => t.key,
      cloud: {
        name: () => t.name,
        allowedBaseUrls: t.allowed,
        listing: () => ({ kind: t.listing }),
        ...(t.custom ? { keyOptional: true } : {}),
      },
      ...(observe ? { observe } : {}),
      // Sir's own hosts: DNS re-checked on every call, no redirects (custom.ts).
      fetch: t.custom ? guardedFetch(baseFetch(), deps.lookup) : baseFetch(),
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

  /**
   * Groq reports its caps per model in headers: x-ratelimit-limit-requests = per day, -tokens =
   * per minute (⚠️ checked 2026-10-28, console.groq.com/docs/rate-limits). Kept per route.
   */
  function learnHeaders(key: string, h: Headers): void {
    const rpd = Number(h.get('x-ratelimit-limit-requests'));
    const tpm = Number(h.get('x-ratelimit-limit-tokens'));
    if (rpd > 0 || tpm > 0)
      learnedLimits.set(key, {
        ...learnedLimits.get(key),
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
    job: PoolJob,
    trail: Trail,
  ): Promise<{ msg: LlmMessage } | { streamed: boolean; error: unknown }> {
    let status: number | undefined;
    let headers: Headers | undefined;
    let target: Target;
    try {
      target = targetOf(r.connectionId, r.provider);
    } catch (error) {
      return { streamed: false, error }; // removed meanwhile: the next route is tried
    }
    const client = clientFor(target, r.model, (o) => {
      status = o.status;
      headers = o.headers;
      learnHeaders(r.key, o.headers);
    });
    const name = target.custom ? target.name : providerName(r.provider);
    let streamed = false;
    const onText = opts.onText;
    const started = now();
    try {
      const raw = await client.stream(r.tier === 3 ? questionOnly(req) : req, {
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
      const msg = r.tier === 3 ? answerOnly(raw) : raw;
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
          name,
          model: r.model,
          tier: r.tier,
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
      trail.attempts.push({ provider: r.provider, name, model: r.model, tier: r.tier, ok: true });
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
      trail.attempts.push({
        provider: r.provider,
        name,
        model: r.model,
        tier: r.tier,
        ok: false,
        reason,
      });
      return { streamed, error };
    }
  }

  /**
   * "Use third-party AIs?": false when Sir chose never or said no; a yes for the session holds
   * until restart (unless he asked to be asked every time). Chat, fusion and images share it.
   */
  async function mayUseTier3(soonestMin: number | null = null): Promise<boolean> {
    if (settings.get('pool.tier3') === 'never') return false;
    const everyTime = settings.get('pool.tier3EveryTime');
    if (tier3ForSession && !everyTime) return true;
    const answer = await deps.ask({ soonestMin, everyTime });
    if (answer === 'session' && !everyTime) tier3ForSession = true;
    return answer !== 'no';
  }

  /** One sub-task's client: tries tier 2, then (with Sir's yes) tier 3; records its trail. */
  function session(job: PoolJob): LlmClient & { trail: Trail } {
    const trail: Trail = { attempts: [] };
    return {
      trail,
      ping: async () => undefined,
      async stream(req, opts) {
        const started = now();
        let failed = 0;
        let tried = 0;
        let lastSkipped: ReturnType<typeof rankRoutes>['skipped'] = [];
        // Phase 4: older tool output and repeats trimmed for small free limits (tier 3 gets the question only).
        const small = settings.get('pool.shrink') ? shrinkRequest(req) : req;
        const tokens = estimateTokens(small);
        const prev = job.sticky ? lastRoute.get(job.sticky) : undefined;
        const before = prev && prev.until > now() ? prev.key : undefined;
        for (const tier of job.tiers ?? ([2, 3] as const)) {
          const all = routes();
          // Tier 3 gets the question only (no tools, no pictures), so it never needs either.
          const needs = tier === 3 ? { tools: false, vision: false } : { ...needsOf(req), tokens };
          const { ranked, skipped } = rankRoutes(
            all,
            { ...needs, tiers: [tier] },
            settings.get('pool.strategy'),
            settings.get('pool.keyOrder'),
            now(),
            settings.get('pool.weights'),
          );
          const picked = byChain(job.pick ? job.pick(ranked) : ranked, job.chain);
          if (tier === 3) {
            // Only ask when a third-party route could actually take this request.
            if (picked.length === 0) break;
            const soon = lastSkipped
              .map((s) => s.route.coolingUntil ?? 0)
              .filter((x) => x > now())
              .sort((a, b) => a - b)[0];
            if (
              !(await mayUseTier3(soon ? Math.max(1, Math.round((soon - now()) / 60_000)) : null))
            )
              break;
          }
          lastSkipped = [...lastSkipped, ...skipped.filter((s) => s.why !== 'tier')];
          // Sticky: the model that answered this conversation goes first while it still can.
          const order =
            before && settings.get('pool.delegation.sticky')
              ? [
                  ...picked.filter((r) => r.key === before),
                  ...picked.filter((r) => r.key !== before),
                ]
              : picked;
          for (const r of order) {
            if (tried >= MAX_ATTEMPTS || (tried > 0 && now() - started > TIME_BUDGET_MS)) break;
            tried += 1;
            // Tier 3 never gets the note: questionOnly takes the current question from req.
            const switched = before && r.key !== before && r.tier === 2;
            const sent = switched && job.handover ? job.handover(small) : small;
            const res = await attempt(r, sent, opts, job, trail);
            if ('msg' in res) {
              if (job.sticky) lastRoute.set(job.sticky, { key: r.key, until: now() + STICKY_MS });
              return res.msg;
            }
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
    mayUseTier3,
    /** Ready = switched on and a tier-2 route set up, or a tier-3 one Jarvis may ask about. */
    ready: (): boolean =>
      settings.get('pool.enabled') &&
      routes().some((r) => r.enabled && (r.tier === 2 || settings.get('pool.tier3') === 'ask')),
    snapshot: (): PoolSnapshot =>
      buildSnapshot({
        db,
        settings,
        secrets: deps.secrets,
        routes: routes(),
        connections: poolConnections(),
        custom: deps.custom.list(),
        health,
        cooling,
        now: now(),
        abilities: deps.abilities,
        claudeCost: (input, output) =>
          costOf(deps.claudePrice(), { input, output, cacheRead: 0, cacheWrite: 0 }),
      }),
    /**
     * Key check: one model-list call per key (no tokens used); providers without a list (Cloudflare,
     * Sir's own) get a one-token "Reply OK" instead.
     */
    async checkKeys(): Promise<void> {
      const keys = [
        ...poolConnections().map((c) => ({
          id: c.id,
          provider: c.provider,
          model: c.model,
        })),
        ...deps.custom.list().map((c) => ({ id: c.id, provider: c.id, model: c.model })),
      ];
      await Promise.all(
        keys.map(async (c) => {
          const at = new Date(now()).toISOString();
          try {
            const t = targetOf(c.id, c.provider);
            const client = clientFor(t, c.model);
            if (t.listing === 'manual') await client.ping(c.model, AbortSignal.timeout(20_000));
            // The list also refreshes the key's models (and their context sizes) for the pool.
            else if (t.custom) await client.listModels();
            else deps.connections.syncLive(c.id, await client.listModelsDetailed());
            health.set(c.id, { health: 'healthy', at });
            if (cooling.get(c.id)?.reason === 'key rejected') cooling.delete(c.id);
          } catch (err) {
            // A rejected key, or (Cloudflare) no Account ID yet: both need Sir.
            const needsSir =
              err instanceof JarvisError &&
              (err.code === 'LLM_AUTH' || err.message === 'no account id');
            health.set(c.id, { health: needsSir ? 'issue' : 'healthy', at });
          }
        }),
      );
    },
    /** Sir's own providers (AI Router → API keys → Add custom provider). */
    custom: deps.custom,
    /** "Test" before saving: the checks of `add`, then a one-token "Reply OK" (nothing else is sent). */
    async testCustom(input: CustomInput): Promise<void> {
      const f = await checkCustom(input, deps.lookup);
      const key = input.apiKey?.trim();
      await clientFor(
        {
          name: f.name,
          baseUrl: f.baseUrl,
          allowed: [f.baseUrl],
          key: key || undefined,
          listing: 'manual',
          custom: true,
        },
        f.model,
      ).ping(f.model, AbortSignal.timeout(20_000));
    },
    /** Forget pauses (Sir fixed a key, or wants to retry now). */
    clearCooldowns: (): void => cooling.clear(),
    /** AI Router → Analytics (Phase 4). */
    analytics: (range: AnalyticsRange): PoolAnalytics =>
      buildAnalytics({
        db,
        range,
        now: now(),
        routes: routes(),
        label: (id) =>
          isCustomProvider(id) ? (deps.custom.find(id)?.name ?? id) : providerName(id),
        claudeCost: (input, output) =>
          costOf(deps.claudePrice(), { input, output, cacheRead: 0, cacheWrite: 0 }),
      }),
    /**
     * Models tab → Test: a one-line "Reply with OK" to every tier-2 door of one model (a real
     * request, recorded and learned from like any other; tier 3 is never tested without asking).
     */
    async testModel(
      model: string,
    ): Promise<
      Array<{ provider: string; name: string; ok: boolean; ms: number; reason?: string }>
    > {
      const doors = routes().filter((r) => r.model === model && r.tier === 2);
      return Promise.all(
        doors.map(async (r) => {
          const trail: Trail = { attempts: [] };
          const t0 = now();
          await attempt(
            r,
            {
              model: 'pool',
              max_tokens: 16,
              messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
            },
            { signal: AbortSignal.timeout(30_000) },
            { id: `test_${t0}`, task: 'Model test' },
            trail,
          );
          const a = trail.attempts[0];
          return {
            provider: r.provider,
            name: a?.name ?? providerName(r.provider),
            ok: a?.ok ?? false,
            ms: now() - t0,
            ...(a?.reason ? { reason: a.reason } : {}),
          };
        }),
      );
    },
    providers: FREE_PROVIDERS,
  };
}

export type FreePool = ReturnType<typeof createFreePool>;
