import type { AnalyticsRange, PoolAnalytics } from '@shared/free-pool';
import type { Db } from '../../db/connection';
import type { RouteState } from './router';

/**
 * AI Router → Analytics (Phase 4): requests, success, speed and tokens over time, per provider
 * and per model, from pool_calls (who was asked and how it went; never the text), plus each
 * provider's outlook for today from its known daily caps and today's pace.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SPAN: Record<AnalyticsRange, number> = {
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  '90d': 90 * DAY,
};

interface Row {
  at: string;
  ok: number;
  ms: number;
  input_tokens: number;
  output_tokens: number;
  provider: string;
  model: string;
}

const clock = (t: number): string =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const p95 = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0;
};

/** One bucket per hour (24h) or per local day (longer ranges), oldest first. */
function bucketsOf(rows: Row[], range: AnalyticsRange, now: number): PoolAnalytics['buckets'] {
  const hourly = range === '24h';
  const count = hourly ? 24 : SPAN[range] / DAY;
  const start = (i: number): number => {
    if (hourly) {
      const h = new Date(now);
      h.setMinutes(0, 0, 0);
      return h.getTime() - (count - 1 - i) * HOUR;
    }
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (count - 1 - i));
    return d.getTime();
  };
  const out = Array.from({ length: count }, (_, i) => {
    const d = new Date(start(i));
    const label = hourly
      ? `${String(d.getHours()).padStart(2, '0')}:00`
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return { label, ok: 0, fail: 0, tokens: 0 };
  });
  const first = start(0);
  const width = hourly ? HOUR : DAY;
  for (const r of rows) {
    const t = Date.parse(r.at);
    // Local days can be 23 or 25 hours long around a clock change: find the bucket by its start.
    let i = Math.floor((t - first) / width);
    while (i + 1 < count && t >= start(i + 1)) i++;
    while (i > 0 && t < start(i)) i--;
    const b = out[i];
    if (!b || t < first) continue;
    if (r.ok) {
      b.ok++;
      b.tokens += r.input_tokens + r.output_tokens;
    } else b.fail++;
  }
  return out;
}

/**
 * Today's outlook for one provider, from the tightest known daily cap among its routes and the
 * pace since the caps reset (00:00 UTC).
 */
export function outlookOf(
  routes: RouteState[],
  now: number,
): { text: string; usedToday: number | null } {
  const capped = routes.filter((r) => r.enabled && (r.limits.rpd || r.limits.tpd));
  const midnight = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate(),
  );
  const reset = midnight + DAY;
  const allOut =
    routes.length > 0 &&
    routes.every((r) => r.coolingReason === 'out of today’s limit' && (r.coolingUntil ?? 0) > now);
  if (allOut) return { text: `used up until ${clock(reset)}`, usedToday: 1 };
  if (capped.length === 0)
    return { text: 'no daily cap published; learned from replies', usedToday: null };
  const daily = (r: RouteState): number =>
    Math.max(
      r.limits.rpd ? r.used.rpd / r.limits.rpd : 0,
      r.limits.tpd ? r.used.tpd / r.limits.tpd : 0,
    );
  // The route with the most room decides: requests move there when the others run out.
  const used = Math.min(1, Math.min(...capped.map(daily)));
  if (used === 0) return { text: 'plenty left today', usedToday: 0 };
  const hours = Math.max((now - midnight) / HOUR, 0.25);
  const left = ((1 - used) / used) * hours * HOUR;
  if (now + left < reset)
    return { text: `runs out around ${clock(now + left)} at this pace`, usedToday: used };
  // Under 5% used and no run-out before the reset: say it plainly.
  if (used < 0.05) return { text: 'plenty left today', usedToday: used };
  return { text: `about ${Math.round((1 - used) * 100)}% left today`, usedToday: used };
}

export function buildAnalytics(x: {
  db: Db;
  range: AnalyticsRange;
  now: number;
  routes: RouteState[];
  label(provider: string): string;
  claudeCost(input: number, output: number): number;
}): PoolAnalytics {
  const since = new Date(x.now - SPAN[x.range]).toISOString();
  const rows = x.db
    .prepare(
      'SELECT at, ok, ms, input_tokens, output_tokens, provider, model FROM pool_calls WHERE at >= ? ORDER BY at',
    )
    .all(since) as unknown as Row[];
  const ok = rows.filter((r) => r.ok);
  const tokensIn = ok.reduce((n, r) => n + r.input_tokens, 0);
  const tokensOut = ok.reduce((n, r) => n + r.output_tokens, 0);

  const group = <K extends string>(key: (r: Row) => K): Map<K, Row[]> => {
    const m = new Map<K, Row[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const rate = (rs: Row[]): number => (rs.length ? rs.filter((r) => r.ok).length / rs.length : 0);
  const avg = (rs: Row[]): number => {
    const good = rs.filter((r) => r.ok);
    return good.length ? good.reduce((n, r) => n + r.ms, 0) / good.length : 0;
  };

  // Every provider with routes now, plus any that answered in the range.
  const byProvider = group((r) => r.provider);
  const ids = [...new Set([...x.routes.map((r) => r.provider), ...byProvider.keys()])];
  const providers = ids.map((id) => {
    const rs = byProvider.get(id) ?? [];
    const o = outlookOf(
      x.routes.filter((r) => r.provider === id),
      x.now,
    );
    return {
      id,
      label: x.label(id),
      requests: rs.length,
      successRate: rate(rs),
      avgMs: avg(rs),
      outlook: o.text,
      usedToday: o.usedToday,
    };
  });
  providers.sort((a, b) => b.requests - a.requests);

  const models = [...group((r) => r.model).entries()]
    .map(([id, rs]) => ({
      id,
      requests: rs.length,
      successRate: rate(rs),
      tokens: rs.filter((r) => r.ok).reduce((n, r) => n + r.input_tokens + r.output_tokens, 0),
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 12);

  return {
    range: x.range,
    buckets: bucketsOf(rows, x.range, x.now),
    totals: {
      requests: rows.length,
      successRate: rate(rows),
      tokensIn,
      tokensOut,
      avgMs: avg(rows),
      p95Ms: p95(ok.map((r) => r.ms)),
      savedUsd: x.claudeCost(tokensIn, tokensOut),
    },
    providers,
    models,
  };
}
