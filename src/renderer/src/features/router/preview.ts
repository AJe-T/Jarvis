import type { PoolModel, PoolProvider, PoolRoute, PoolSnapshot } from '@shared/free-pool';

/**
 * Step 0 sample data: shows the layout before the pool exists. Every number here is made up and
 * the page says so; Phase 1 replaces this with `pool:snapshot` from main (same shape).
 */

const CHECKED = '2026-10-27';

function provider(
  id: string,
  label: string,
  tier: PoolProvider['tier'],
  docsUrl: string,
  keys: PoolProvider['keys'],
): PoolProvider {
  return { id, label, tier, enabled: true, keys, docsUrl, checked: CHECKED };
}

function key(
  id: string,
  hint: string,
  health: PoolProvider['keys'][number]['health'],
  used: number,
) {
  return {
    id,
    hint,
    health,
    lastChecked: health === 'unchecked' ? null : '09:12',
    usedToday: used,
  };
}

export const PREVIEW_PROVIDERS: PoolProvider[] = [
  provider('gemini', 'Google Gemini', 2, 'https://ai.google.dev/gemini-api/docs/rate-limits', [
    key('gemini-1', 'x9Qa', 'healthy', 0.42),
    key('gemini-2', 'P2mL', 'healthy', 0.18),
  ]),
  provider('groq', 'Groq', 2, 'https://console.groq.com/docs/rate-limits', [
    key('groq-1', 'b7Tz', 'cooling', 0.91),
  ]),
  provider('cerebras', 'Cerebras', 2, 'https://inference-docs.cerebras.ai/support/rate-limits', [
    key('cerebras-1', 'Kd03', 'healthy', 0.35),
  ]),
  provider('openrouter', 'OpenRouter', 2, 'https://openrouter.ai/docs/api-reference/limits', [
    key('openrouter-1', 'm4Rw', 'healthy', 0.6),
  ]),
  provider(
    'cloudflare',
    'Cloudflare Workers AI',
    2,
    'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    [key('cloudflare-1', 'Zt8e', 'healthy', 0.12)],
  ),
  provider('nvidia', 'NVIDIA NIM', 2, 'https://docs.api.nvidia.com/', [
    key('nvidia-1', 'f1Hc', 'unchecked', 0),
  ]),
  provider('mistral', 'Mistral', 2, 'https://docs.mistral.ai/deployment/laplateforme/tier/', [
    key('mistral-1', 'q0Vn', 'issue', 0),
  ]),
  provider('pollinations', 'Pollinations', 3, 'https://pollinations.ai/', []),
  provider('aihorde', 'AI Horde', 3, 'https://aihorde.net/', []),
];

function route(
  providerId: string,
  tier: PoolRoute['tier'],
  rpm: number,
  rpd: number,
  used: number,
) {
  return { providerId, tier, limits: { rpm, rpd }, usedFraction: used };
}

function model(m: Omit<PoolModel, 'enabled'>): PoolModel {
  return { ...m, enabled: true };
}

export const PREVIEW_MODELS: PoolModel[] = [
  model({
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    maker: 'Google',
    size: 'large',
    contextK: 1000,
    tools: true,
    vision: true,
    monthlyTokens: 25_000_000,
    usedTokens: 9_400_000,
    reliability: 96,
    speed: 71,
    intelligence: 88,
    score: 0.884,
    routes: [
      route('gemini', 2, 10, 250, 0.42),
      route('openrouter', 2, 20, 50, 0.3),
      route('pollinations', 3, 12, 0, 0),
    ],
  }),
  model({
    id: 'gpt-oss-120b',
    label: 'GPT-OSS 120B',
    maker: 'OpenAI',
    size: 'large',
    contextK: 131,
    tools: true,
    vision: false,
    monthlyTokens: 105_000_000,
    usedTokens: 31_000_000,
    reliability: 89,
    speed: 98,
    intelligence: 76,
    score: 0.879,
    routes: [
      route('groq', 2, 30, 1000, 0.91),
      route('cerebras', 2, 30, 14_400, 0.35),
      route('openrouter', 2, 20, 50, 0.3),
    ],
  }),
  model({
    id: 'llama-3.3-70b',
    label: 'Llama 3.3 70B',
    maker: 'Meta',
    size: 'large',
    contextK: 128,
    tools: true,
    vision: false,
    monthlyTokens: 60_000_000,
    usedTokens: 12_800_000,
    reliability: 92,
    speed: 90,
    intelligence: 64,
    score: 0.826,
    routes: [
      route('groq', 2, 30, 1000, 0.91),
      route('cerebras', 2, 30, 14_400, 0.35),
      route('cloudflare', 2, 300, 0, 0.12),
      route('nvidia', 2, 40, 0, 0),
    ],
  }),
  model({
    id: 'qwen3-32b',
    label: 'Qwen3 32B',
    maker: 'Alibaba',
    size: 'medium',
    contextK: 128,
    tools: true,
    vision: false,
    monthlyTokens: 30_000_000,
    usedTokens: 4_100_000,
    reliability: 90,
    speed: 93,
    intelligence: 61,
    score: 0.812,
    routes: [route('groq', 2, 60, 1000, 0.91), route('cerebras', 2, 30, 14_400, 0.35)],
  }),
  model({
    id: 'deepseek-v3',
    label: 'DeepSeek V3',
    maker: 'DeepSeek',
    size: 'frontier',
    contextK: 128,
    tools: true,
    vision: false,
    monthlyTokens: 6_000_000,
    usedTokens: 5_200_000,
    reliability: 78,
    speed: 34,
    intelligence: 97,
    score: 0.774,
    routes: [route('openrouter', 2, 20, 50, 0.3), route('nvidia', 2, 40, 0, 0)],
  }),
  model({
    id: 'gemma-3-27b',
    label: 'Gemma 3 27B',
    maker: 'Google',
    size: 'medium',
    contextK: 128,
    tools: false,
    vision: true,
    monthlyTokens: 45_000_000,
    usedTokens: 2_300_000,
    reliability: 94,
    speed: 66,
    intelligence: 52,
    score: 0.752,
    routes: [
      route('gemini', 2, 30, 14_400, 0.42),
      route('cloudflare', 2, 300, 0, 0.12),
      route('openrouter', 2, 20, 50, 0.3),
    ],
  }),
  model({
    id: 'mistral-small',
    label: 'Mistral Small 3.2',
    maker: 'Mistral',
    size: 'medium',
    contextK: 128,
    tools: true,
    vision: true,
    monthlyTokens: 100_000_000,
    usedTokens: 0,
    reliability: 0,
    speed: 0,
    intelligence: 55,
    score: 0,
    routes: [route('mistral', 2, 60, 0, 0)],
  }),
  model({
    id: 'llama-3.1-8b',
    label: 'Llama 3.1 8B Instant',
    maker: 'Meta',
    size: 'small',
    contextK: 128,
    tools: true,
    vision: false,
    monthlyTokens: 15_000_000,
    usedTokens: 900_000,
    reliability: 97,
    speed: 100,
    intelligence: 22,
    score: 0.731,
    routes: [route('groq', 2, 30, 14_400, 0.91), route('aihorde', 3, 0, 0, 0)],
  }),
];

export function previewSnapshot(now = Date.now()): PoolSnapshot {
  const ago = (min: number): string => new Date(now - min * 60_000).toISOString();
  const ahead = (min: number): string => new Date(now + min * 60_000).toISOString();
  return {
    preview: true,
    enabled: true,
    strategy: 'balanced',
    providers: PREVIEW_PROVIDERS,
    models: PREVIEW_MODELS,
    recent: [
      {
        id: 'a1',
        at: ago(2),
        task: 'Summarise 3 web pages about solar panels',
        modelLabel: 'GPT-OSS 120B',
        providerId: 'cerebras',
        tier: 2,
        tried: [{ providerId: 'groq', reason: 'rate limited (per minute)' }],
        ms: 2140,
        tokens: 6120,
      },
      {
        id: 'a2',
        at: ago(9),
        task: 'Draft a reply to the landlord email',
        modelLabel: 'Gemini 2.5 Flash',
        providerId: 'gemini',
        tier: 2,
        tried: [],
        ms: 3380,
        tokens: 1840,
      },
      {
        id: 'a3',
        at: ago(26),
        task: 'Translate the product description to Hindi',
        modelLabel: 'Llama 3.3 70B',
        providerId: 'cloudflare',
        tier: 2,
        tried: [
          { providerId: 'groq', reason: 'rate limited (per minute)' },
          { providerId: 'cerebras', reason: 'server error 503' },
        ],
        ms: 4920,
        tokens: 2310,
      },
    ],
    pressure: [
      {
        providerId: 'groq',
        modelLabel: 'GPT-OSS 120B',
        reason: 'Rate limited (per minute)',
        until: ahead(1),
      },
      {
        providerId: 'mistral',
        modelLabel: 'Mistral Small 3.2',
        reason: 'Key rejected (check it)',
        until: ahead(300),
      },
    ],
    today: { requests: 184, successRate: 0.962, tokens: 412_000, savedUsd: 1.86 },
  };
}
