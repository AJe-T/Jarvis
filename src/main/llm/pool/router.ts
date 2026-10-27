import type { ModelSize, PoolLimits, RoutingStrategy } from '@shared/free-pool';

/**
 * AI Router Phase 1: which free routes to try, in what order. Pure, so it is tested without a
 * network. Idea from FreeLLMAPI's router (score = reliability, speed and smarts, scaled down as a
 * route nears its limits; hard limits skip it); our own code and numbers.
 */

export interface RouteState {
  key: string;
  connectionId: string;
  provider: string;
  model: string;
  tier: 2 | 3;
  enabled: boolean;
  /** Place in the Priority order (lower first). */
  order: number;
  limits: PoolLimits;
  /** Use inside the current windows: requests and tokens in the last minute and this UTC day. */
  used: { rpm: number; rpd: number; tpm: number; tpd: number };
  /** Epoch ms the route is paused until (rate limited, failing, bad key). */
  coolingUntil?: number;
  coolingReason?: string;
  /** Last 7 days: answered / failed, average ms, output tokens per second (0 = unknown). */
  stats: { ok: number; fail: number; avgMs: number; tokPerSec: number };
  /** null = unknown; false once a provider refused tools or pictures for this model. */
  tools: boolean | null;
  vision: boolean | null;
  /** Epoch ms of the last attempt (for "take turns" key order). */
  lastUsed: number;
}

export interface Needs {
  tools: boolean;
  vision: boolean;
  tiers: ReadonlyArray<2 | 3>;
}

export type SkipReason =
  'off' | 'tier' | 'cooling' | 'rpm' | 'rpd' | 'tpm' | 'tpd' | 'tools' | 'vision';

export interface Ranked {
  ranked: RouteState[];
  skipped: Array<{ route: RouteState; why: SkipReason }>;
}

/** Fraction (0..1) of the tightest known cap already used; 0 when no cap is known. */
export function usedFraction(r: Pick<RouteState, 'limits' | 'used'>): number {
  const pairs: Array<[number, number | undefined]> = [
    [r.used.rpm, r.limits.rpm],
    [r.used.rpd, r.limits.rpd],
    [r.used.tpm, r.limits.tpm],
    [r.used.tpd, r.limits.tpd],
  ];
  return Math.min(1, Math.max(0, ...pairs.map(([used, cap]) => (cap ? used / cap : 0))));
}

function skipReason(r: RouteState, needs: Needs, now: number): SkipReason | null {
  if (!r.enabled) return 'off';
  if (!needs.tiers.includes(r.tier)) return 'tier';
  if (r.coolingUntil && r.coolingUntil > now) return 'cooling';
  if (r.limits.rpm && r.used.rpm >= r.limits.rpm) return 'rpm';
  if (r.limits.rpd && r.used.rpd >= r.limits.rpd) return 'rpd';
  if (r.limits.tpm && r.used.tpm >= r.limits.tpm) return 'tpm';
  if (r.limits.tpd && r.used.tpd >= r.limits.tpd) return 'tpd';
  if (needs.tools && r.tools === false) return 'tools';
  if (needs.vision && r.vision === false) return 'vision';
  return null;
}

const SIZE_SCORE: Record<ModelSize, number> = {
  frontier: 1,
  large: 0.8,
  medium: 0.55,
  small: 0.3,
  unknown: 0.5,
};

/** Beta(1,1) prior: an untried route starts at 0.5, not at 0 or 1. */
export const reliabilityOf = (s: RouteState['stats']): number => (s.ok + 1) / (s.ok + s.fail + 2);

/** 60 output tokens/s ≈ 0.63; unmeasured routes get an optimistic 0.6 so they are tried. */
export const speedOf = (s: RouteState['stats']): number =>
  s.tokPerSec > 0 ? 1 - Math.exp(-s.tokPerSec / 60) : 0.6;

/** Below 20% room left a route's score shrinks, down to 10% of itself at 0 room. */
export function headroomFactor(used: number): number {
  const left = 1 - used;
  return left >= 0.2 ? 1 : 0.1 + 0.9 * (left / 0.2);
}

export function balancedScore(r: RouteState): number {
  const base =
    0.5 * reliabilityOf(r.stats) +
    0.25 * speedOf(r.stats) +
    0.25 * SIZE_SCORE[modelMeta(r.model).size];
  return base * headroomFactor(usedFraction(r));
}

export function rankRoutes(
  routes: RouteState[],
  needs: Needs,
  strategy: RoutingStrategy,
  keyOrder: 'roomiest' | 'turns',
  now: number,
): Ranked {
  const skipped: Ranked['skipped'] = [];
  const ok: RouteState[] = [];
  for (const r of routes) {
    const why = skipReason(r, needs, now);
    if (why) skipped.push({ route: r, why });
    else ok.push(r);
  }
  // Same model and tier, several keys: the roomiest (or the least recently used) first.
  const keyTie = (a: RouteState, b: RouteState): number =>
    keyOrder === 'turns' ? a.lastUsed - b.lastUsed : usedFraction(a) - usedFraction(b);
  const tierFirst = (a: RouteState, b: RouteState): number => a.tier - b.tier;
  const ranked =
    strategy === 'priority'
      ? ok.sort((a, b) => tierFirst(a, b) || a.order - b.order || keyTie(a, b))
      : ok.sort((a, b) => tierFirst(a, b) || balancedScore(b) - balancedScore(a) || keyTie(a, b));
  return { ranked, skipped };
}

const WHY_GROUP: Record<SkipReason, string> = {
  cooling: 'rate limited or paused',
  rpm: 'rate limited or paused',
  rpd: 'out of today’s limit',
  tpm: 'rate limited or paused',
  tpd: 'out of today’s limit',
  off: 'switched off',
  tier: 'third-party (not allowed)',
  tools: 'can’t use tools',
  vision: 'can’t see pictures',
};

/** "All free AIs are busy: 7 routes checked (5 rate limited…). Soonest back in about 2 min." */
export function summarizeExhaustion(
  skipped: Ranked['skipped'],
  failed: number,
  now: number,
): string {
  const groups = new Map<string, number>();
  for (const s of skipped) {
    const g = WHY_GROUP[s.why];
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  if (failed) groups.set('failed just now', failed);
  const total = skipped.length + failed;
  if (total === 0) return 'No free AI is set up yet: add a key on AI Router → Providers & keys.';
  const parts = [...groups.entries()].map(([g, n]) => `${n} ${g}`).join(', ');
  const soonest = skipped
    .map((s) => s.route.coolingUntil ?? 0)
    .filter((t) => t > now)
    .sort((a, b) => a - b)[0];
  const back = soonest
    ? ` Soonest back in about ${Math.max(1, Math.round((soonest - now) / 60_000))} min.`
    : '';
  return `All free AIs are busy: ${total} route${total === 1 ? '' : 's'} checked (${parts}).${back}`;
}

// ── Model names → label, maker, size (providers only give an id) ───────────────────────────

const MAKERS: Array<[RegExp, string]> = [
  [/gemini|gemma|palm/i, 'Google'],
  [/llama|meta-/i, 'Meta'],
  [/gpt|openai|o\d-/i, 'OpenAI'],
  [/qwen|qwq/i, 'Alibaba'],
  [/mistral|mixtral|codestral|magistral|devstral|ministral/i, 'Mistral'],
  [/deepseek/i, 'DeepSeek'],
  [/kimi|moonshot/i, 'Moonshot'],
  [/glm|zhipu|z-ai/i, 'Zhipu'],
  [/nemotron|nvidia/i, 'NVIDIA'],
  [/grok/i, 'xAI'],
  [/claude/i, 'Anthropic'],
  [/phi-|microsoft/i, 'Microsoft'],
];

export function modelMeta(id: string): { label: string; maker: string; size: ModelSize } {
  const bare = (id.split('/').pop() ?? id).replace(/:free$/i, '');
  const label = bare
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(\d+(?:\.\d+)?)b\b/gi, '$1B')
    .trim();
  const maker =
    MAKERS.find(([re]) => re.test(id))?.[1] ?? (id.includes('/') ? (id.split('/')[0] ?? '') : '');
  const params = /(\d+(?:\.\d+)?)b\b/i.exec(bare);
  let size: ModelSize = 'unknown';
  if (params) {
    const b = Number(params[1]);
    size = b >= 200 ? 'frontier' : b >= 60 ? 'large' : b >= 20 ? 'medium' : 'small';
  } else if (/\b(pro|ultra|opus)\b/i.test(bare)) size = 'frontier';
  else if (/\b(lite|mini|nano|small|tiny|instant)\b/i.test(bare)) size = 'small';
  else if (/\b(flash|large|medium|sonnet)\b/i.test(bare)) size = 'large';
  return { label, maker, size };
}
