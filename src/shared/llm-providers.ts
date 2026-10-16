/**
 * Cloud AI providers Jarvis can use as its brain through their OpenAI-compatible chat API
 * (same translation as the local model, ADR-013). The addresses are fixed here, never typed by
 * Sir, so a whole conversation can only go to one of these hosts.
 * ⚠️ Verified against each provider's docs on 2026-10-16; model names change often, so the
 * model is picked from the provider's own /models list in Settings.
 */
export const CLOUD_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT models)',
    baseUrl: 'https://api.openai.com/v1',
    secret: 'openai',
    keyHint: 'sk-…',
    keysUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    secret: 'gemini',
    keyHint: 'AIza…',
    keysUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    secret: 'deepseek',
    keyHint: 'sk-…',
    keysUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    secret: 'xai',
    keyHint: 'xai-…',
    keysUrl: 'https://console.x.ai',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    secret: 'mistral',
    keyHint: '',
    keysUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'groq',
    label: 'Groq (fast open models)',
    baseUrl: 'https://api.groq.com/openai/v1',
    secret: 'groq',
    keyHint: 'gsk_…',
    keysUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (hundreds of models, one key)',
    baseUrl: 'https://openrouter.ai/api/v1',
    secret: 'openrouter',
    keyHint: 'sk-or-…',
    keysUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    secret: 'together',
    keyHint: '',
    keysUrl: 'https://api.together.ai/settings/api-keys',
  },
] as const;

export type CloudProviderId = (typeof CLOUD_PROVIDERS)[number]['id'];
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export const CLOUD_PROVIDER_IDS = CLOUD_PROVIDERS.map((p) => p.id) as [
  CloudProviderId,
  ...CloudProviderId[],
];

export function cloudProvider(id: CloudProviderId): CloudProvider {
  return CLOUD_PROVIDERS.find((p) => p.id === id) ?? CLOUD_PROVIDERS[0];
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
