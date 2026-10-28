import { z } from 'zod';
import type { CloudProviderId } from './llm-providers';

/**
 * AI Router (free pool, 2.29 layout, 2.30 Phase 1). Ideas from FreeLLMAPI (tashfeenahmed/freellmapi,
 * MIT); our own code.
 *
 * Tiers are about WHO RECEIVES the text, not which model answers it: Gemini through Google is
 * tier 2, the same Gemini through an unknown relay is tier 3.
 * 1 = Jarvis's brain and this PC (private data allowed) · 2 = trusted free · 3 = third-party.
 */

export const PoolTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type PoolTier = z.infer<typeof PoolTierSchema>;

/** Which build phase wires a feature (the UI shows a badge until then). */
export type PoolPhase = 1 | 2 | 3 | 4;

export const ROUTING_STRATEGIES = [
  { id: 'priority', label: 'Priority', phase: 1, weights: 'your order, top to bottom' },
  { id: 'balanced', label: 'Balanced', phase: 1, weights: 'reliability 50 · speed 25 · smarts 25' },
  { id: 'smartest', label: 'Smartest', phase: 4, weights: 'reliability 35 · speed 10 · smarts 55' },
  { id: 'fastest', label: 'Fastest', phase: 4, weights: 'reliability 35 · speed 55 · smarts 10' },
  {
    id: 'reliable',
    label: 'Most reliable',
    phase: 4,
    weights: 'reliability 70 · speed 15 · smarts 15',
  },
  { id: 'custom', label: 'Custom', phase: 4, weights: 'your own weights' },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  phase: PoolPhase;
  weights: string;
}>;

export const ROUTING_STRATEGY_IDS = ROUTING_STRATEGIES.map((s) => s.id) as [
  RoutingStrategy,
  ...RoutingStrategy[],
];
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number]['id'];
/** Phase 4 (2.34): every strategy runs. Kept for the IPC schema. */
export const LIVE_STRATEGIES = ROUTING_STRATEGY_IDS;

/** How much each strategy cares about reliability, speed and smarts (each set sums to 1). */
export const ScoreWeightsSchema = z.object({
  reliability: z.number().min(0).max(1),
  speed: z.number().min(0).max(1),
  smarts: z.number().min(0).max(1),
});
export type ScoreWeights = z.infer<typeof ScoreWeightsSchema>;
export const STRATEGY_WEIGHTS: Record<
  Exclude<RoutingStrategy, 'priority' | 'custom'>,
  ScoreWeights
> = {
  balanced: { reliability: 0.5, speed: 0.25, smarts: 0.25 },
  smartest: { reliability: 0.35, speed: 0.1, smarts: 0.55 },
  fastest: { reliability: 0.35, speed: 0.55, smarts: 0.1 },
  reliable: { reliability: 0.7, speed: 0.15, smarts: 0.15 },
};

/** A named order of models for one kind of job ("Coding", "Vision"): Phase 4 named chains. */
export const PoolChainSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[\p{L}\p{N} _-]+$/u),
  models: z.array(z.string().min(1).max(200)).max(30),
});
export type PoolChain = z.infer<typeof PoolChainSchema>;
export const MAX_CHAINS = 8;

export const ANALYTICS_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** AI Router → Analytics (Phase 4): read from pool_calls (kept 92 days; never the text). */
export const PoolAnalyticsSchema = z.object({
  range: z.enum(ANALYTICS_RANGES),
  buckets: z.array(
    z.object({ label: z.string(), ok: z.number(), fail: z.number(), tokens: z.number() }),
  ),
  totals: z.object({
    requests: z.number(),
    successRate: z.number(),
    tokensIn: z.number(),
    tokensOut: z.number(),
    avgMs: z.number(),
    p95Ms: z.number(),
    savedUsd: z.number(),
  }),
  providers: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      requests: z.number(),
      successRate: z.number(),
      avgMs: z.number(),
      /** "runs out around 19:40 at this pace", "plenty left today"… */
      outlook: z.string(),
      /** 0..1 of today's tightest known daily cap, or null when none is known. */
      usedToday: z.number().nullable(),
    }),
  ),
  models: z.array(
    z.object({ id: z.string(), requests: z.number(), successRate: z.number(), tokens: z.number() }),
  ),
});
export type PoolAnalytics = z.infer<typeof PoolAnalyticsSchema>;

/** Per-minute / per-day request and token caps (undefined = not published, learned from 429s). */
export const PoolLimitsSchema = z.object({
  rpm: z.number().int().positive().optional(),
  rpd: z.number().int().positive().optional(),
  tpm: z.number().int().positive().optional(),
  tpd: z.number().int().positive().optional(),
});
export type PoolLimits = z.infer<typeof PoolLimitsSchema>;

/** A daily cap for one model (or every model of an account). */
export interface DailyCap {
  tpd?: number;
  rpd?: number;
}

/**
 * The free allowance a provider gives, as AI Router → Usage adds it up (2.35).
 * - `model`: every model has its own daily cap, so a key's allowance is the sum over its models.
 * - `account`: one daily cap shared by every model of the key.
 * `source` says where the numbers come from: the provider's own docs, or an estimate (third-party
 * lists, or our arithmetic from a credit unit) that Sir can replace with his console's numbers.
 */
export interface AllowanceDef {
  scope: 'model' | 'account';
  /** Daily cap for the account, or for any model not in `models`. */
  daily: DailyCap;
  /** Per-model caps, matched by the longest id prefix ("gemma-" covers every Gemma). */
  models?: Record<string, DailyCap>;
  /** A monthly token allowance instead of a daily one (Mistral). */
  tokensMonth?: number;
  /** No daily cap at all, only a per-minute one (NVIDIA). */
  unlimited?: boolean;
  perMinute?: string;
  resets: string;
  source: 'published' | 'estimate';
}

export interface FreeProviderDef {
  id: CloudProviderId;
  /** Default tier; Sir can move a provider between 2 and 3 (`pool.providers`). */
  tier: 2 | 3;
  /** Per-minute caps the router obeys; daily caps come from `allowance` (per model or account). */
  limits: PoolLimits;
  allowance: AllowanceDef;
  /** Where the limits (or their absence) were read. */
  limitsUrl: string;
  /** ⚠️ Date the limits page was checked. */
  checked: string;
  note: string;
}

/**
 * Providers whose keys join the pool. ⚠️ Checked 2026-10-28 against each limits page. Groq's table
 * is public (and its x-ratelimit-* headers report each model's daily requests); OpenRouter's
 * GET /api/v1/key reports the live free-request count; Cerebras publishes per-model caps.
 * Gemini, Mistral and NVIDIA show free limits only in the signed-in console, and Cloudflare counts
 * "neurons", so those are estimates marked as such. Cloudflare Workers AI (2.31) has Sir's
 * account id inside its fixed address, filled in by code (ADR-045).
 */
export const FREE_PROVIDERS: readonly FreeProviderDef[] = [
  {
    id: 'gemini',
    tier: 2,
    limits: {},
    allowance: {
      scope: 'model',
      // ⚠️ Estimate: Google shows free limits only in AI Studio; third-party lists agree on these.
      daily: { rpd: 20 },
      models: { 'gemma-': { rpd: 1_000 } },
      perMinute: '10–15 requests',
      resets: 'midnight Pacific time',
      source: 'estimate',
    },
    limitsUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    checked: '2026-10-28',
    note: 'Free limits are shown per project in AI Studio, by requests (no daily token cap). Numbers here are estimates: type yours from AI Studio.',
  },
  {
    id: 'groq',
    tier: 2,
    limits: {},
    allowance: {
      scope: 'model',
      daily: {},
      models: {
        'openai/gpt-oss-120b': { rpd: 1_000, tpd: 200_000 },
        'openai/gpt-oss-20b': { rpd: 1_000, tpd: 200_000 },
        'openai/gpt-oss-safeguard-20b': { rpd: 1_000, tpd: 200_000 },
        'qwen/qwen3.8-27b': { rpd: 1_000, tpd: 200_000 },
      },
      perMinute: '30 requests',
      resets: 'every day',
      source: 'published',
    },
    limitsUrl: 'https://console.groq.com/docs/rate-limits',
    checked: '2026-10-28',
    note: 'Caps are per model for your organisation. Models not in the docs table are learned from x-ratelimit-* headers (requests per day).',
  },
  {
    id: 'cerebras',
    tier: 2,
    limits: { rpm: 5, tpm: 30_000 },
    allowance: {
      scope: 'model',
      daily: { tpd: 1_000_000 },
      perMinute: '5 requests, 30K tokens',
      resets: 'continuously (rolling)',
      source: 'published',
    },
    limitsUrl: 'https://inference-docs.cerebras.ai/support/rate-limits',
    checked: '2026-10-28',
    note: 'Free Trial: 5 requests and 30K uncached tokens per minute, 1M tokens per day, per model.',
  },
  {
    id: 'openrouter',
    tier: 2,
    limits: { rpm: 20 },
    allowance: {
      scope: 'account',
      daily: { rpd: 50 },
      perMinute: '20 requests',
      resets: 'midnight UTC',
      source: 'published',
    },
    limitsUrl: 'https://openrouter.ai/docs/api-reference/limits',
    checked: '2026-10-28',
    note: 'Free models (ids ending :free): 50 requests a day across all of them (1,000 after buying 10 credits). Key checks read the live count from OpenRouter.',
  },
  {
    id: 'nvidia',
    tier: 2,
    limits: {},
    allowance: {
      scope: 'account',
      daily: {},
      unlimited: true,
      perMinute: '40 requests',
      resets: 'no daily cap',
      source: 'estimate',
    },
    limitsUrl: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
    checked: '2026-10-28',
    note: 'No daily cap published; developer forums report 40 requests a minute. Free for prototyping, not production.',
  },
  {
    id: 'mistral',
    tier: 2,
    limits: { rpm: 60 },
    allowance: {
      scope: 'account',
      daily: {},
      tokensMonth: 1_000_000_000,
      perMinute: '1 request a second',
      resets: 'every month',
      source: 'estimate',
    },
    limitsUrl: 'https://docs.mistral.ai/deployment/laplateforme/tier',
    checked: '2026-10-28',
    note: 'The free Experiment plan shows its limits only in the console; third-party lists say about 1 billion tokens a month.',
  },
  {
    id: 'cloudflare',
    tier: 2,
    limits: {},
    allowance: {
      scope: 'account',
      // 10,000 neurons/day ÷ ~40,000 neurons per million mixed tokens (3:1 in:out, Llama 3.1 8B /
      // gpt-oss-120b rows of the pricing table) ≈ 250K; 70B models get about half.
      daily: { tpd: 250_000 },
      resets: 'midnight UTC',
      source: 'estimate',
    },
    limitsUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    checked: '2026-10-28',
    note: 'Free: 10,000 neurons a day, reset at 00:00 UTC. A request costs neurons by model and length; 250K tokens is an average (big models get about half). Needs your Account ID.',
  },
];

const short = (n: number): string =>
  n >= 1e9 ? `${n / 1e9}B` : n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n);

/** One line for the Add a key list: "1M tokens a day per model", "~1B tokens a month". */
export function allowanceHint(a: AllowanceDef): string {
  const est = a.source === 'estimate' ? '~' : '';
  if (a.unlimited) return `no daily cap, ${a.perMinute ?? 'limited'} a minute`;
  if (a.tokensMonth) return `${est}${short(a.tokensMonth)} tokens a month`;
  const cap = { ...Object.values(a.models ?? {})[0], ...a.daily };
  const per = a.scope === 'model' ? ' per model' : '';
  if (cap.tpd) return `${est}${short(cap.tpd)} tokens a day${per}`;
  if (cap.rpd) return `${est}${short(cap.rpd)} requests a day${per}`;
  return 'free tier';
}

/** A model's own daily cap: the longest matching prefix in `models`, else the default. */
export function modelCap(a: AllowanceDef, model: string): DailyCap {
  const id = model.replace(/^models\//, '');
  const hit = Object.keys(a.models ?? {})
    .filter((k) => id === k || id.startsWith(k))
    .sort((x, y) => y.length - x.length)[0];
  return hit ? (a.models?.[hit] ?? a.daily) : a.daily;
}

/** Model-list entries that aren't chat models: speech, embeddings, pictures, safety filters. */
const NOT_CHAT =
  /whisper|tts|orpheus|playai|embed|guard|safety|rerank|moderation|imagen|image|veo|lyria|aqa|ocr|flux|diffusion|bge-|clip/i;

/**
 * A model a key with nothing chosen joins the pool with (2.33.1). OpenRouter's other models are
 * paid, so only ids ending ":free" count there.
 */
export function isFreeChatModel(provider: string, model: string): boolean {
  if (NOT_CHAT.test(model)) return false;
  return provider !== 'openrouter' || model.endsWith(':free');
}

// ── Sir's own tier-3 providers (Security.md §16.15, ADR-045) ───────────────────────────────

/** `custom_<n>`; a number is never handed out twice (removed rows stay). */
export const CUSTOM_ID_RE = /^custom_\d{1,3}$/;
export const isCustomProvider = (id: string): boolean => CUSTOM_ID_RE.test(id);
/** The DPAPI secret holding a custom provider's key. */
export const customSecret = (id: string): string => `custom_ai_${id.slice('custom_'.length)}`;
/** Protected like the providers' own keys: an MCP server can't be bound to it. */
export const isCustomSecret = (name: string): boolean => /^custom_ai_\d{1,3}$/.test(name);
export const MAX_CUSTOM_PROVIDERS = 10;

export const freeProvider = (id: string): FreeProviderDef | undefined =>
  FREE_PROVIDERS.find((p) => p.id === id);

/** Where a provider's key hides in a .env file (FreeLLMAPI and most tools use these names). */
export const ENV_KEY_NAMES: Record<string, CloudProviderId> = {
  GEMINI_API_KEY: 'gemini',
  GOOGLE_API_KEY: 'gemini',
  GROQ_API_KEY: 'groq',
  CEREBRAS_API_KEY: 'cerebras',
  OPENROUTER_API_KEY: 'openrouter',
  NVIDIA_API_KEY: 'nvidia',
  NVIDIA_NIM_API_KEY: 'nvidia',
  MISTRAL_API_KEY: 'mistral',
  CLOUDFLARE_API_TOKEN: 'cloudflare',
};

// ── Private data (Security.md §16.15): a turn that used any of these never leaves tier 1 ──

export const PRIVATE_SOURCES = [
  { id: 'memory', label: 'Memory and the vault' },
  { id: 'files', label: 'Files on this PC' },
  { id: 'screen', label: 'Screenshots and the screen' },
  { id: 'passwords', label: 'Passwords' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'messages', label: 'WhatsApp, Telegram and email' },
] as const;
export type PrivateSourceId = (typeof PRIVATE_SOURCES)[number]['id'];

/** Native tools whose output is Sir's private data. MCP and other non-native tools all count. */
export const PRIVATE_TOOLS: Record<string, PrivateSourceId> = {
  memory: 'memory',
  search_memory: 'memory',
  recall_earlier: 'memory',
  search_conversations: 'memory',
  spaces: 'memory',
  npc_memory: 'memory',
  goals: 'memory',
  tasks: 'memory',
  calendar: 'memory',
  list_reminders: 'memory',
  list_meals: 'memory',
  get_location: 'memory',
  read_text_file: 'files',
  read_document: 'files',
  search_files: 'files',
  show_file: 'files',
  look_at_screen: 'screen',
  read_screen_text: 'screen',
  read_window_text: 'screen',
  save_screenshot: 'screen',
  look_through_camera: 'screen',
  list_ui_elements: 'screen',
  computer: 'screen',
  list_open_windows: 'screen',
  run_powershell: 'files',
  search_tool_output: 'files',
  list_installed_apps: 'files',
  organize_folder: 'files',
  get_system_info: 'files',
  network_info: 'files',
  generate_password: 'passwords',
  read_clipboard: 'clipboard',
  help_me_reply: 'messages',
  send_whatsapp: 'messages',
};

/**
 * The only tools a free-pool sub-agent may use: public lookups whose input and output are not
 * Sir's data. An allowlist, so a tool added later stays out until someone checks it.
 */
export const POOL_TOOLS: ReadonlySet<string> = new Set([
  'get_datetime',
  'get_world_time',
  'get_weather',
  'convert_currency',
  'define_word',
  'distance_between',
  'get_market_price',
  'wikipedia',
  'fetch_web_page',
  'read_feed',
  'youtube_transcript',
  // Phase 3 (2.33): every query is checked in code before it leaves the PC (pool/search.ts).
  'free_web_search',
]);

/** The private source a tool's output counts as, or null when it's public (web, weather…). */
export function privateSourceOf(tool: { name: string; source?: string }): string | null {
  const id = PRIVATE_TOOLS[tool.name];
  if (id) return PRIVATE_SOURCES.find((s) => s.id === id)?.label ?? id;
  if (tool.source && tool.source !== 'native') return `the ${tool.name} connection`;
  return null;
}

// ── What the AI Router page shows (pool:snapshot) ─────────────────────────────────────────

export const KeyHealthSchema = z.enum(['healthy', 'cooling', 'issue', 'unchecked']);
export type KeyHealth = z.infer<typeof KeyHealthSchema>;

export const PoolKeySchema = z.object({
  /** The connection id (conn_groq, conn_groq_2…). */
  id: z.string(),
  label: z.string(),
  /** Last four characters, as the key fields in Settings show them. */
  hint: z.string(),
  health: KeyHealthSchema,
  lastChecked: z.string().nullable(),
  /** 0..1 of today's tightest known cap already used; 0 when no cap is known. */
  usedToday: z.number(),
  requestsToday: z.number().int(),
});
export type PoolKey = z.infer<typeof PoolKeySchema>;

export const PoolProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  tier: PoolTierSchema,
  enabled: z.boolean(),
  keys: z.array(PoolKeySchema),
  docsUrl: z.string(),
  checked: z.string(),
  note: z.string(),
  /** One of Sir's own providers: always tier 3, address fixed once saved. */
  custom: z.object({ host: z.string(), model: z.string() }).optional(),
});
export type PoolProvider = z.infer<typeof PoolProviderSchema>;

/** One way to reach a model: through one connection, which decides the tier. */
export const PoolRouteSchema = z.object({
  providerId: z.string(),
  connectionId: z.string(),
  tier: PoolTierSchema,
  limits: PoolLimitsSchema,
  usedFraction: z.number(),
  coolingUntil: z.string().optional(),
  coolingReason: z.string().optional(),
});
export type PoolRoute = z.infer<typeof PoolRouteSchema>;

export const ModelSizeSchema = z.enum(['frontier', 'large', 'medium', 'small', 'unknown']);
export type ModelSize = z.infer<typeof ModelSizeSchema>;

export const PoolModelSchema = z.object({
  /** The model id as the providers write it; routes with the same id are one model. */
  id: z.string(),
  label: z.string(),
  maker: z.string(),
  size: ModelSizeSchema,
  contextK: z.number(),
  /** null = not known yet (learned when a provider refuses tools or pictures). */
  tools: z.boolean().nullable(),
  vision: z.boolean().nullable(),
  monthlyTokens: z.number(),
  usedTokens: z.number(),
  /** 0..100 per axis; the router's combined score is 0..1 (0 = not measured yet). */
  reliability: z.number(),
  speed: z.number(),
  intelligence: z.number(),
  score: z.number(),
  enabled: z.boolean(),
  routes: z.array(PoolRouteSchema),
});
export type PoolModel = z.infer<typeof PoolModelSchema>;

/** One answer the pool gave, with every route it tried first (the trail). */
export const PoolAnswerSchema = z.object({
  id: z.string(),
  at: z.string(),
  task: z.string(),
  modelLabel: z.string(),
  providerId: z.string(),
  tier: PoolTierSchema,
  tried: z.array(z.object({ providerId: z.string(), reason: z.string() })),
  ms: z.number(),
  tokens: z.number(),
});
export type PoolAnswer = z.infer<typeof PoolAnswerSchema>;

/** A route that is paused right now and why (cooldowns). */
export const PoolPressureSchema = z.object({
  providerId: z.string(),
  modelLabel: z.string(),
  reason: z.string(),
  until: z.string(),
});
export type PoolPressure = z.infer<typeof PoolPressureSchema>;

/** Phase 2 delegation rules (settings `pool.delegation.*`). */
export const PoolDelegationSchema = z.object({
  delegate: z.boolean(),
  frontDoor: z.boolean(),
  sticky: z.boolean(),
  handover: z.boolean(),
  fallback: z.boolean(),
  budgetAware: z.boolean(),
});
export type PoolDelegation = z.infer<typeof PoolDelegationSchema>;
export const DELEGATION_KEYS = Object.keys(PoolDelegationSchema.shape) as Array<
  keyof PoolDelegation
>;

// ── Phase 3 abilities (2.33, settings `pool.abilities.*`) ─────────────────────────────────────

/** Switches on AI Router → Abilities. `voiceHearing` sends Sir's recorded voice out: off by default. */
export const PoolAbilitySettingsSchema = z.object({
  search: z.boolean(),
  image: z.boolean(),
  fusion: z.boolean(),
  voiceSpeaking: z.boolean(),
  voiceHearing: z.boolean(),
});
export type PoolAbilitySettings = z.infer<typeof PoolAbilitySettingsSchema>;
export const ABILITY_KEYS = Object.keys(PoolAbilitySettingsSchema.shape) as Array<
  keyof PoolAbilitySettings
>;

export interface SearchProviderDef {
  id: 'tavily' | 'brave' | 'exa' | 'firecrawl' | 'linkup';
  name: string;
  /** DPAPI secret name (API keys → Free search keys). */
  secret: string;
  /** ⚠️ Free allowance as the provider states it (checked date below). */
  free: string;
  signupUrl: string;
}

/**
 * Free search APIs, tried in this order (Sir's choice). ⚠️ Endpoints, auth headers and reply shapes
 * checked against each provider's API reference on 2026-10-28; allowances are learned from replies
 * (429 / 402 / 432) since most dashboards show them only after sign-in.
 */
export const SEARCH_PROVIDERS: readonly SearchProviderDef[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    secret: 'search_tavily',
    free: '1,000 credits a month',
    signupUrl: 'https://app.tavily.com',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    secret: 'search_brave',
    free: '$5 credit a month (about 1,000 searches); needs a card, set a spending limit',
    signupUrl: 'https://api-dashboard.search.brave.com',
  },
  {
    id: 'exa',
    name: 'Exa',
    secret: 'search_exa',
    free: 'free starting credit',
    signupUrl: 'https://dashboard.exa.ai',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    secret: 'search_firecrawl',
    free: 'free starting credits',
    signupUrl: 'https://www.firecrawl.dev/app',
  },
  {
    id: 'linkup',
    name: 'Linkup',
    secret: 'search_linkup',
    free: 'free monthly credit',
    signupUrl: 'https://app.linkup.so',
  },
];
export const SEARCH_SECRETS: ReadonlySet<string> = new Set(SEARCH_PROVIDERS.map((p) => p.secret));

export const IMAGE_SIZES = ['square', 'wide', 'tall'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** A cooldown learned from a provider's reply, as the page shows it. */
const Pause = z.object({ until: z.string(), reason: z.string() });

export const PoolAbilitiesSchema = z.object({
  settings: PoolAbilitySettingsSchema,
  search: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      free: z.string(),
      signupUrl: z.string(),
      secret: z.string(),
      keySet: z.boolean(),
      last4: z.string().optional(),
      usedToday: z.number(),
      pause: Pause.optional(),
    }),
  ),
  /** Claude's paid web search is switched on in Settings (the last resort). */
  paidSearch: z.boolean(),
  image: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      model: z.string(),
      tier: PoolTierSchema,
      ready: z.boolean(),
      sizes: z.array(z.enum(IMAGE_SIZES)),
      note: z.string(),
      pause: Pause.optional(),
    }),
  ),
  /** Who would answer a fusion job now ("Groq · llama-3.3-70b"), or empty when under two providers. */
  fusion: z.object({ drafters: z.array(z.string()), judge: z.string().nullable() }),
  /** The engine in use right now, by name (no silent switching). */
  voice: z.object({ hearing: z.string().nullable(), speaking: z.string().nullable() }),
});
export type PoolAbilities = z.infer<typeof PoolAbilitiesSchema>;

// ── AI Router → Usage (2.35): free allowance against use, per day, week and month ─────────────

/** limit null = not known (no published cap, nothing learned, nothing typed by Sir). */
const AllowanceCell = z.object({ limit: z.number().nullable(), used: z.number() });
const AllowancePeriods = z.object({
  day: AllowanceCell,
  week: AllowanceCell,
  month: AllowanceCell,
});
export type AllowancePeriods = z.infer<typeof AllowancePeriods>;
export const ALLOWANCE_PERIODS = ['day', 'week', 'month'] as const;
export type AllowancePeriod = (typeof ALLOWANCE_PERIODS)[number];

/** Where a provider's numbers come from, strongest first. */
export const AllowanceSourceSchema = z.enum([
  'yours',
  'live',
  'learned',
  'published',
  'estimate',
  'unknown',
]);
export type AllowanceSource = z.infer<typeof AllowanceSourceSchema>;

export const PoolAllowanceSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      keys: z.number().int(),
      enabled: z.boolean(),
      tokens: AllowancePeriods,
      requests: AllowancePeriods,
      source: AllowanceSourceSchema,
      /** Some of the key's models have no known cap: the limit counts only the known ones. */
      partial: z.boolean(),
      unlimited: z.boolean(),
      perMinute: z.string(),
      resets: z.string(),
      note: z.string(),
      docsUrl: z.string(),
      /** Sir's own daily numbers from the provider's console (they win). */
      yours: z.object({ tpd: z.number().optional(), rpd: z.number().optional() }),
    }),
  ),
  totals: z.object({ tokens: AllowancePeriods, requests: AllowancePeriods }),
});
export type PoolAllowance = z.infer<typeof PoolAllowanceSchema>;

export const PoolSnapshotSchema = z.object({
  /** True while the numbers are samples (2.29 layout); false when main serves them. */
  preview: z.boolean(),
  enabled: z.boolean(),
  strategy: z.enum(ROUTING_STRATEGY_IDS),
  tier3: z.enum(['ask', 'never']),
  tier3EveryTime: z.boolean(),
  keyOrder: z.enum(['roomiest', 'turns']),
  checkHours: z.number(),
  retryEmpty: z.boolean(),
  delegation: PoolDelegationSchema,
  abilities: PoolAbilitiesSchema,
  /** Phase 4 routing settings. */
  weights: ScoreWeightsSchema,
  learn: z.boolean(),
  shrink: z.boolean(),
  chains: z.array(PoolChainSchema),
  providers: z.array(PoolProviderSchema),
  models: z.array(PoolModelSchema),
  recent: z.array(PoolAnswerSchema),
  pressure: z.array(PoolPressureSchema),
  allowance: PoolAllowanceSchema,
  today: z.object({
    requests: z.number(),
    successRate: z.number(),
    tokens: z.number(),
    savedUsd: z.number(),
  }),
});
export type PoolSnapshot = z.infer<typeof PoolSnapshotSchema>;

/** A route key in settings and the ledger: "<connection>|<model>". */
export const routeKey = (connectionId: string, model: string): string => `${connectionId}|${model}`;
