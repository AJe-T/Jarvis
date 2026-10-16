import { z } from 'zod';

/**
 * Cloud AI providers and gateways Jarvis can use as its brain through their OpenAI-compatible chat
 * API (same translation as the local model, ADR-013). The addresses are fixed here, never typed by
 * Sir, so a whole conversation can only go to one of these hosts.
 * ⚠️ Each entry's address and model list were checked against the provider's docs on `checked`.
 * None is live-tested without Sir's key; docs/Integrations.md has the full matrix.
 */

/**
 * How Settings gets a provider's models: 'openai' = GET {baseUrl}/models; 'ollama' = GET
 * `modelsUrl` in Ollama's {models:[{name}]} shape; 'manual' = no documented list, Sir types the id.
 */
export type ModelListing = 'openai' | 'ollama' | 'manual';

export interface CloudProviderDef {
  id: string;
  label: string;
  /** 'model-api' = the company's own models; 'gateway' = one key for many companies' models. */
  category: 'model-api' | 'gateway';
  baseUrl: string;
  /** Secret name in secrets.bin (Security.md §8). */
  secret: string;
  keyHint: string;
  /** Where Sir gets a key (or the docs page that explains it). */
  keysUrl: string;
  docsUrl: string;
  models: ModelListing;
  /** Only for models: 'ollama'; fixed here like baseUrl. */
  modelsUrl?: string;
  /** Tool calling: 'yes' when every chat model takes tools, 'per-model' on gateways. */
  tools: 'yes' | 'per-model';
  /** Date the docs were checked. */
  checked: string;
  /** Shown under the key field when the provider needs something special. */
  note?: string;
}

export const CLOUD_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT models)',
    category: 'model-api',
    baseUrl: 'https://api.openai.com/v1',
    secret: 'openai',
    keyHint: 'sk-…',
    keysUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    models: 'openai',
    tools: 'yes',
    checked: '2026-10-16',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    category: 'model-api',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    secret: 'gemini',
    keyHint: 'AIza…',
    keysUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    models: 'openai',
    tools: 'yes',
    checked: '2026-10-16',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    category: 'model-api',
    baseUrl: 'https://api.deepseek.com',
    secret: 'deepseek',
    keyHint: 'sk-…',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/',
    models: 'openai',
    tools: 'yes',
    checked: '2026-10-16',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    category: 'model-api',
    baseUrl: 'https://api.x.ai/v1',
    secret: 'xai',
    keyHint: 'xai-…',
    keysUrl: 'https://console.x.ai',
    docsUrl: 'https://docs.x.ai/docs/api-reference',
    models: 'openai',
    tools: 'yes',
    checked: '2026-10-16',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    category: 'model-api',
    baseUrl: 'https://api.mistral.ai/v1',
    secret: 'mistral',
    keyHint: '',
    keysUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/api/',
    models: 'openai',
    tools: 'yes',
    checked: '2026-10-16',
  },
  {
    id: 'groq',
    label: 'Groq (fast open models)',
    category: 'model-api',
    baseUrl: 'https://api.groq.com/openai/v1',
    secret: 'groq',
    keyHint: 'gsk_…',
    keysUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs/openai',
    models: 'openai',
    tools: 'per-model',
    checked: '2026-10-16',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (hundreds of models, one key)',
    category: 'gateway',
    baseUrl: 'https://openrouter.ai/api/v1',
    secret: 'openrouter',
    keyHint: 'sk-or-…',
    keysUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs/api-reference/overview',
    models: 'openai',
    tools: 'per-model',
    checked: '2026-10-16',
  },
  {
    id: 'together',
    label: 'Together AI',
    category: 'gateway',
    baseUrl: 'https://api.together.xyz/v1',
    secret: 'together',
    keyHint: '',
    keysUrl: 'https://api.together.ai/settings/api-keys',
    docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
    models: 'openai',
    tools: 'per-model',
    checked: '2026-10-16',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face (Inference Providers)',
    category: 'gateway',
    baseUrl: 'https://router.huggingface.co/v1',
    // The same token Jarvis uses for model downloads and the Hugging Face MCP preset.
    secret: 'huggingface',
    keyHint: 'hf_…',
    keysUrl: 'https://huggingface.co/settings/tokens',
    docsUrl: 'https://huggingface.co/docs/inference-providers/index',
    models: 'openai',
    tools: 'per-model',
    checked: '2026-10-16',
    note: 'The token needs the "Make calls to Inference Providers" permission.',
  },
  {
    id: 'vercel',
    label: 'Vercel AI Gateway',
    category: 'gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    secret: 'vercel_ai',
    keyHint: '',
    keysUrl: 'https://vercel.com/docs/ai-gateway/authentication',
    docsUrl: 'https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions',
    models: 'openai',
    tools: 'per-model',
    checked: '2026-10-16',
  },
  {
    id: 'requesty',
    label: 'Requesty (model router)',
    category: 'gateway',
    baseUrl: 'https://router.requesty.ai/v1',
    secret: 'requesty',
    keyHint: '',
    keysUrl: 'https://docs.requesty.ai/quickstart',
    docsUrl: 'https://docs.requesty.ai/quickstart',
    models: 'openai',
    tools: 'per-model',
    checked: '2026-10-16',
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    category: 'gateway',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    secret: 'deepinfra',
    keyHint: '',
    keysUrl: 'https://docs.deepinfra.com/chat/overview',
    docsUrl: 'https://docs.deepinfra.com/chat/overview',
    models: 'manual',
    tools: 'per-model',
    checked: '2026-10-16',
    note: 'DeepInfra documents no model list: copy the model id from deepinfra.com/models.',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    category: 'gateway',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    secret: 'fireworks',
    keyHint: 'fw_…',
    keysUrl: 'https://docs.fireworks.ai/tools-sdks/openai-compatibility',
    docsUrl: 'https://docs.fireworks.ai/tools-sdks/openai-compatibility',
    models: 'manual',
    tools: 'per-model',
    checked: '2026-10-16',
    note: 'Fireworks documents no model list: copy the id (accounts/fireworks/models/…) from fireworks.ai/models.',
  },
  {
    id: 'ollamacloud',
    label: 'Ollama cloud',
    category: 'gateway',
    baseUrl: 'https://ollama.com/v1',
    secret: 'ollama_cloud',
    keyHint: '',
    keysUrl: 'https://ollama.com/settings/keys',
    docsUrl: 'https://docs.ollama.com/cloud',
    models: 'ollama',
    modelsUrl: 'https://ollama.com/api/tags',
    tools: 'per-model',
    checked: '2026-10-16',
  },
] as const satisfies readonly CloudProviderDef[];

export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number]['id'];
export type CloudProvider = CloudProviderDef & { id: CloudProviderId };

export const CLOUD_PROVIDER_IDS = CLOUD_PROVIDERS.map((p) => p.id) as [
  CloudProviderId,
  ...CloudProviderId[],
];

export function cloudProvider(id: CloudProviderId): CloudProvider {
  return CLOUD_PROVIDERS.find((p) => p.id === id) ?? CLOUD_PROVIDERS[0];
}

// ── Connections (integrations step 3) ───────────────────────────────────────────────────────

/**
 * A saved key for one provider. Each provider's own key (secret = its `secret`) is the connection
 * `conn_<provider>`; Sir may add more keys (a work account, a second plan) as `conn_<provider>_<n>`
 * with secret `<secret>_<n>`.
 */
export const CONNECTION_ID_RE = /^conn_[a-z]{2,20}(_\d{1,2})?$/;
export const MAX_CONNECTIONS_PER_PROVIDER = 5;
export const defaultConnectionId = (p: CloudProviderId): string => `conn_${p}`;

/** The secret name of a provider's n-th key (n ≥ 2); the first is the provider's own `secret`. */
export const connectionSecret = (p: CloudProviderId, n: number): string =>
  n <= 1 ? cloudProvider(p).secret : `${cloudProvider(p).secret}_${n}`;

const EXTRA_SECRET_RE = new RegExp(
  `^(${CLOUD_PROVIDERS.map((p) => p.secret).join('|')})_\\d{1,2}$`,
);
/** An extra connection's key (protected like the provider's own key, Security.md §10). */
export const isConnectionSecret = (name: string): boolean => EXTRA_SECRET_RE.test(name);

/** Where a model in the registry came from. */
export type ModelSource = 'live' | 'manual' | 'cached';

export interface ConnectionModel {
  model: string;
  source: ModelSource;
  favourite: boolean;
  enabled: boolean;
  seenAt: string | null;
}

export interface AiConnection {
  id: string;
  provider: CloudProviderId;
  label: string;
  /** Secret name in secrets.bin (the key itself never leaves main). */
  secret: string;
  /** The provider's own key (cannot be removed, only cleared). */
  primary: boolean;
  model: string;
  keySet: boolean;
  models: ConnectionModel[];
}

/**
 * Every AI Jarvis can hand work to (delegate_task, NPCs): his own connection, the local model,
 * each cloud provider above, and Sir's ChatGPT / Google plans through their official apps.
 */
export const BRAIN_IDS = [
  'jarvis',
  'local',
  ...CLOUD_PROVIDER_IDS,
  'chatgpt',
  'antigravity',
] as const;
export type BrainId = (typeof BRAIN_IDS)[number];

export const BRAIN_LABELS: Record<BrainId, string> = {
  jarvis: 'Jarvis (main connection)',
  local: 'Local model',
  ...(Object.fromEntries(CLOUD_PROVIDERS.map((p) => [p.id, p.label])) as Record<
    CloudProviderId,
    string
  >),
  chatgpt: 'ChatGPT plan (Codex app)',
  antigravity: 'Gemini plan (Antigravity app)',
};

/** A brain by name, or one of Sir's extra connections by id (conn_openai_2). */
export type BrainRef = BrainId | `conn_${string}`;

/** A brain's display name; extra connections need their names from main (`extra`). */
export const brainLabel = (b: BrainRef, extra: Record<string, string> = {}): string =>
  (BRAIN_LABELS as Record<string, string>)[b] ?? extra[b] ?? b;
export const BrainRefSchema = z.union([
  z.enum(BRAIN_IDS),
  z.custom<`conn_${string}`>((v) => typeof v === 'string' && CONNECTION_ID_RE.test(v)),
]);
