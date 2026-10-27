import type { PoolModel, PoolProvider, PoolRoute, PoolSnapshot } from '@shared/free-pool';

/**
 * Sample data in the real snapshot shape: the router tests' stand-in for `pool:snapshot`
 * (2.29 showed it as the layout preview). Every number here is made up.
 */

const CHECKED = '2026-10-27';

function provider(
  id: string,
  label: string,
  tier: PoolProvider['tier'],
  keys: PoolProvider['keys'],
): PoolProvider {
  return {
    id,
    label,
    tier,
    enabled: true,
    keys,
    docsUrl: 'https://example.com',
    checked: CHECKED,
    note: '',
  };
}

function key(
  id: string,
  hint: string,
  health: PoolProvider['keys'][number]['health'],
  used: number,
): PoolProvider['keys'][number] {
  return {
    id,
    label: 'Main key',
    hint,
    health,
    lastChecked: health === 'unchecked' ? null : '2026-10-27T09:12:00.000Z',
    usedToday: used,
    requestsToday: Math.round(used * 100),
  };
}

export const PREVIEW_PROVIDERS: PoolProvider[] = [
  provider('gemini', 'Google Gemini', 2, [
    key('conn_gemini', 'x9Qa', 'healthy', 0.42),
    key('conn_gemini_2', 'P2mL', 'healthy', 0.18),
  ]),
  provider('groq', 'Groq', 2, [key('conn_groq', 'b7Tz', 'cooling', 0.91)]),
  provider('cerebras', 'Cerebras', 2, [key('conn_cerebras', 'Kd03', 'healthy', 0.35)]),
  provider('openrouter', 'OpenRouter', 2, [key('conn_openrouter', 'm4Rw', 'healthy', 0.6)]),
  provider('nvidia', 'NVIDIA NIM', 2, [key('conn_nvidia', 'f1Hc', 'unchecked', 0)]),
  provider('mistral', 'Mistral', 3, [key('conn_mistral', 'q0Vn', 'issue', 0)]),
];

function route(providerId: string, tier: PoolRoute['tier'], rpm: number, used: number): PoolRoute {
  return {
    providerId,
    connectionId: `conn_${providerId}`,
    tier,
    limits: { rpm },
    usedFraction: used,
  };
}

function model(m: Omit<PoolModel, 'enabled' | 'contextK' | 'monthlyTokens'>): PoolModel {
  return { ...m, enabled: true, contextK: 0, monthlyTokens: 0 };
}

export const PREVIEW_MODELS: PoolModel[] = [
  model({
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    maker: 'Google',
    size: 'large',
    tools: true,
    vision: true,
    usedTokens: 9_400_000,
    reliability: 96,
    speed: 71,
    intelligence: 80,
    score: 0.884,
    routes: [
      route('gemini', 2, 10, 0.42),
      route('openrouter', 2, 20, 0.3),
      route('mistral', 3, 5, 0),
    ],
  }),
  model({
    id: 'gpt-oss-120b',
    label: 'Gpt Oss 120B',
    maker: 'OpenAI',
    size: 'large',
    tools: true,
    vision: null,
    usedTokens: 31_000_000,
    reliability: 89,
    speed: 98,
    intelligence: 80,
    score: 0.879,
    routes: [route('groq', 2, 30, 0.91), route('cerebras', 2, 5, 0.35)],
  }),
  model({
    id: 'llama-3.3-70b',
    label: 'Llama 3.3 70B',
    maker: 'Meta',
    size: 'large',
    tools: null,
    vision: false,
    usedTokens: 12_800_000,
    reliability: 92,
    speed: 90,
    intelligence: 80,
    score: 0.826,
    routes: [route('groq', 2, 30, 0.91), route('nvidia', 2, 40, 0)],
  }),
];

export function previewSnapshot(now = Date.now()): PoolSnapshot {
  const ago = (min: number): string => new Date(now - min * 60_000).toISOString();
  const ahead = (min: number): string => new Date(now + min * 60_000).toISOString();
  return {
    preview: true,
    enabled: true,
    strategy: 'balanced',
    tier3: 'ask',
    tier3EveryTime: false,
    keyOrder: 'roomiest',
    checkHours: 6,
    retryEmpty: true,
    delegation: {
      delegate: true,
      frontDoor: false,
      sticky: true,
      handover: true,
      fallback: true,
      budgetAware: true,
    },
    abilities: {
      settings: {
        search: true,
        image: true,
        fusion: true,
        voiceSpeaking: true,
        voiceHearing: false,
      },
      search: [],
      paidSearch: true,
      image: [],
      fusion: { drafters: [], judge: null },
      voice: { hearing: null, speaking: null },
    },
    providers: PREVIEW_PROVIDERS,
    models: PREVIEW_MODELS,
    recent: [
      {
        id: 'a1',
        at: ago(2),
        task: 'Summarise 3 web pages about solar panels',
        modelLabel: 'Gpt Oss 120B',
        providerId: 'cerebras',
        tier: 2,
        tried: [{ providerId: 'groq', reason: 'rate limited' }],
        ms: 2140,
        tokens: 6120,
      },
    ],
    pressure: [
      { providerId: 'groq', modelLabel: 'Gpt Oss 120B', reason: 'rate limited', until: ahead(1) },
    ],
    today: { requests: 184, successRate: 0.962, tokens: 412_000, savedUsd: 1.86 },
  };
}
