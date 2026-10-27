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
/** Strategies Phase 1 can run; the others are drawn but disabled. */
export const LIVE_STRATEGIES = ['priority', 'balanced'] as const;

/** Per-minute / per-day request and token caps (undefined = not published, learned from 429s). */
export const PoolLimitsSchema = z.object({
  rpm: z.number().int().positive().optional(),
  rpd: z.number().int().positive().optional(),
  tpm: z.number().int().positive().optional(),
  tpd: z.number().int().positive().optional(),
});
export type PoolLimits = z.infer<typeof PoolLimitsSchema>;

export interface FreeProviderDef {
  id: CloudProviderId;
  /** Default tier; Sir can move a provider between 2 and 3 (`pool.providers`). */
  tier: 2 | 3;
  /** Free-tier caps where the provider publishes them; the rest are learned from its replies. */
  limits: PoolLimits;
  /** Where the limits (or their absence) were read. */
  limitsUrl: string;
  /** ⚠️ Date the limits page was checked. */
  checked: string;
  note: string;
}

/**
 * Providers whose keys join the pool. ⚠️ Checked 2026-10-27 against each limits page: Groq and
 * Gemini show free limits only in the signed-in console, NVIDIA's page lists none, so those are
 * learned (429 + retry-after, Groq's x-ratelimit-* headers). Cloudflare Workers AI (2.31) has
 * Sir's account id inside its fixed address, filled in by code (ADR-045).
 */
export const FREE_PROVIDERS: readonly FreeProviderDef[] = [
  {
    id: 'gemini',
    tier: 2,
    limits: {},
    limitsUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    checked: '2026-10-27',
    note: 'Free limits are shown per account in AI Studio; learned from replies.',
  },
  {
    id: 'groq',
    tier: 2,
    limits: {},
    limitsUrl: 'https://console.groq.com/docs/rate-limits',
    checked: '2026-10-27',
    note: 'Free limits are shown per account in the console; learned from x-ratelimit-* headers.',
  },
  {
    id: 'cerebras',
    tier: 2,
    limits: { rpm: 5, tpm: 30_000, tpd: 1_000_000 },
    limitsUrl: 'https://inference-docs.cerebras.ai/support/rate-limits',
    checked: '2026-10-27',
    note: 'Free Trial: 5 requests and 30K uncached tokens per minute, 1M tokens per day.',
  },
  {
    id: 'openrouter',
    tier: 2,
    limits: { rpm: 20, rpd: 50 },
    limitsUrl: 'https://openrouter.ai/docs/api-reference/limits',
    checked: '2026-10-27',
    note: 'Free models (ids ending :free): 20 per minute, 50 per day (1,000 after buying 10 credits).',
  },
  {
    id: 'nvidia',
    tier: 2,
    limits: {},
    limitsUrl: 'https://docs.api.nvidia.com/nim/reference/llm-apis',
    checked: '2026-10-27',
    note: 'No free limits published; learned from replies.',
  },
  {
    id: 'mistral',
    tier: 2,
    limits: {},
    limitsUrl: 'https://docs.mistral.ai/deployment/laplateforme/tier/',
    checked: '2026-10-27',
    note: 'Limits depend on the workspace plan; learned from replies.',
  },
  {
    id: 'cloudflare',
    tier: 2,
    limits: {},
    limitsUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    checked: '2026-10-27',
    note: 'Free: 10,000 neurons a day, reset at 00:00 UTC. A request costs neurons by model and length, so the cap is learned from replies. Needs your Account ID in Settings → Models & AI.',
  },
];

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
  providers: z.array(PoolProviderSchema),
  models: z.array(PoolModelSchema),
  recent: z.array(PoolAnswerSchema),
  pressure: z.array(PoolPressureSchema),
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
