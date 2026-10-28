import {
  FREE_PROVIDERS,
  modelCap,
  routeKey,
  type AllowancePeriods,
  type AllowanceSource,
  type PoolAllowance,
  type PoolLimits,
} from '@shared/free-pool';
import type { Db } from '../../db/connection';

/**
 * AI Router → Usage (2.35): how many free tokens and requests Sir's keys get per day, week and
 * month, and how many he used. A daily cap counts once per model (Groq, Gemini, Cerebras) or once
 * per key (OpenRouter, Cloudflare); a week is seven days of it and a month this month's days.
 * Strongest number wins: Sir's own, then the provider's live count, then what replies taught us,
 * then the docs, then an estimate.
 */

export interface AllowanceInput {
  db: Db;
  now: number;
  overrides: Record<
    string,
    { enabled?: boolean | undefined; tpd?: number | undefined; rpd?: number | undefined }
  >;
  /** Free providers' keys and the models each one lends the pool. */
  connections: Array<{ id: string; provider: string; poolModels: string[] }>;
  /** Caps learned from replies, by connection id or route key. */
  learned: (key: string) => PoolLimits | undefined;
  /** OpenRouter's own count of today's free requests, by connection id. */
  live: ReadonlyMap<string, { used: number; limit: number; day: string }>;
  label: (id: string) => string;
}

interface Daily {
  tpd: number | null;
  rpd: number | null;
  tokensMonth: number | null;
  partial: boolean;
  learned: boolean;
  live: boolean;
}

const add = (a: number | null, b: number | undefined): number | null =>
  b === undefined ? a : (a ?? 0) + b;

/** One key's daily allowance. */
function keyDaily(x: AllowanceInput, c: AllowanceInput['connections'][number], day: string): Daily {
  const a = FREE_PROVIDERS.find((p) => p.id === c.provider)?.allowance;
  const out: Daily = {
    tpd: null,
    rpd: null,
    tokensMonth: a?.tokensMonth ?? null,
    partial: false,
    learned: false,
    live: false,
  };
  if (!a || a.unlimited) return out;
  if (a.scope === 'account') {
    const live = x.live.get(c.id);
    const learnedRpd = x.learned(c.id)?.rpd;
    return {
      ...out,
      tpd: a.daily.tpd ?? null,
      rpd: live && live.day === day ? live.limit : (learnedRpd ?? a.daily.rpd ?? null),
      learned: learnedRpd !== undefined,
      live: Boolean(live && live.day === day),
    };
  }
  let { tpd, rpd, partial, learned } = out;
  for (const m of c.poolModels) {
    const cap = modelCap(a, m);
    const heard = x.learned(routeKey(c.id, m))?.rpd;
    if (heard !== undefined) learned = true;
    tpd = add(tpd, cap.tpd);
    rpd = add(rpd, heard ?? cap.rpd);
    if (cap.tpd === undefined || (heard ?? cap.rpd) === undefined) partial = true;
  }
  return { ...out, tpd, rpd, partial, learned };
}

/** Days in the UTC month of `ms`. */
const monthDays = (ms: number): number => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

function periods(
  daily: number | null,
  monthly: number | null,
  used: { day: number; week: number; month: number },
  days: number,
): AllowancePeriods {
  const perDay = daily ?? (monthly !== null ? monthly / days : null);
  const cell = (limit: number | null, u: number): AllowancePeriods['day'] => ({
    limit: limit === null ? null : Math.round(limit),
    used: u,
  });
  return {
    day: cell(perDay, used.day),
    week: cell(perDay === null ? null : perDay * 7, used.week),
    month: cell(monthly ?? (perDay === null ? null : perDay * days), used.month),
  };
}

/**
 * The totals count only providers with a known cap, on both sides: an uncapped provider's use
 * must not eat into the others' "left" (the page names those providers under the total).
 */
function sumPeriods(list: AllowancePeriods[]): AllowancePeriods {
  const sum = (k: keyof AllowancePeriods): AllowancePeriods['day'] => {
    const known = list.map((p) => p[k]).filter((c) => c.limit !== null);
    return {
      limit: known.length ? known.reduce((a, c) => a + (c.limit ?? 0), 0) : null,
      used: known.reduce((n, c) => n + c.used, 0),
    };
  };
  return { day: sum('day'), week: sum('week'), month: sum('month') };
}

export function buildAllowance(x: AllowanceInput): PoolAllowance {
  const today = new Date(x.now).toISOString().slice(0, 10);
  const weekStart = new Date(x.now - 6 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const days = monthDays(x.now);

  // 429s and calls that never got an answer (timeouts, network) are not use: providers don't
  // count them. The week can reach into last month, so read from whichever starts first.
  const usage = x.db
    .prepare(
      `SELECT provider,
              SUM(CASE WHEN day = ? THEN 1 ELSE 0 END) AS rDay,
              SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS rWeek,
              SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS rMonth,
              SUM(CASE WHEN day = ? THEN input_tokens + output_tokens ELSE 0 END) AS tDay,
              SUM(CASE WHEN day >= ? THEN input_tokens + output_tokens ELSE 0 END) AS tWeek,
              SUM(CASE WHEN day >= ? THEN input_tokens + output_tokens ELSE 0 END) AS tMonth
       FROM pool_calls
       WHERE day >= ? AND NOT (ok = 0 AND (status IS NULL OR status = 429))
       GROUP BY provider`,
    )
    .all(
      today,
      weekStart,
      monthStart,
      today,
      weekStart,
      monthStart,
      weekStart < monthStart ? weekStart : monthStart,
    ) as Array<
    Record<'provider', string> &
      Record<'rDay' | 'rWeek' | 'rMonth' | 'tDay' | 'tWeek' | 'tMonth', number>
  >;

  const providers = FREE_PROVIDERS.flatMap((def) => {
    const keys = x.connections.filter((c) => c.provider === def.id);
    if (keys.length === 0) return [];
    const own = x.overrides[def.id] ?? {};
    const per = keys.map((c) => keyDaily(x, c, today));
    const total = per.reduce(
      (a, d) => ({
        tpd: d.tpd === null ? a.tpd : add(a.tpd, d.tpd),
        rpd: d.rpd === null ? a.rpd : add(a.rpd, d.rpd),
        tokensMonth: d.tokensMonth === null ? a.tokensMonth : add(a.tokensMonth, d.tokensMonth),
        partial: a.partial || d.partial,
        learned: a.learned || d.learned,
        live: a.live || d.live,
      }),
      {
        tpd: null,
        rpd: null,
        tokensMonth: null,
        partial: false,
        learned: false,
        live: false,
      } as Daily,
    );
    const u = usage.find((r) => r.provider === def.id);
    // OpenRouter counts requests made outside Jarvis too: its number wins when higher.
    const liveUsed = keys
      .map((c) => x.live.get(c.id))
      .reduce((n, l) => n + (l && l.day === today ? l.used : 0), 0);
    const reqUsed = {
      day: Math.max(u?.rDay ?? 0, liveUsed),
      week: Math.max(u?.rWeek ?? 0, liveUsed),
      month: Math.max(u?.rMonth ?? 0, liveUsed),
    };
    const tokUsed = { day: u?.tDay ?? 0, week: u?.tWeek ?? 0, month: u?.tMonth ?? 0 };
    const tpd = own.tpd ?? total.tpd;
    const rpd = own.rpd ?? total.rpd;
    const known =
      tpd !== null || rpd !== null || total.tokensMonth !== null || def.allowance.unlimited;
    let source: AllowanceSource = known ? def.allowance.source : 'unknown';
    if (total.learned) source = 'learned';
    if (total.live) source = 'live';
    if (own.tpd !== undefined || own.rpd !== undefined) source = 'yours';
    return [
      {
        id: def.id,
        label: x.label(def.id),
        keys: keys.length,
        enabled: own.enabled ?? true,
        tokens: periods(tpd, own.tpd ? null : total.tokensMonth, tokUsed, days),
        requests: periods(rpd, null, reqUsed, days),
        source,
        partial: total.partial && own.tpd === undefined,
        unlimited: def.allowance.unlimited ?? false,
        perMinute: def.allowance.perMinute ?? '',
        resets: def.allowance.resets,
        note: def.note,
        docsUrl: def.limitsUrl,
        yours: {
          ...(own.tpd !== undefined ? { tpd: own.tpd } : {}),
          ...(own.rpd !== undefined ? { rpd: own.rpd } : {}),
        },
      },
    ];
  });

  return {
    providers,
    totals: {
      // A switched-off provider lends the pool nothing, so it stays out of the totals.
      tokens: sumPeriods(providers.filter((p) => p.enabled).map((p) => p.tokens)),
      requests: sumPeriods(providers.filter((p) => p.enabled).map((p) => p.requests)),
    },
  };
}
