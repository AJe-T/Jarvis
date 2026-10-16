import {
  BRAIN_IDS,
  CLOUD_PROVIDERS,
  cloudProvider,
  type BrainId,
  type CloudProviderId,
} from '@shared/llm-providers';
import type { ToolCatalogEntry } from '../agent/agent-loop';
import type { SecretStore } from '../settings/secrets';
import type { SettingsService } from '../settings/settings-service';
import type { CliBrain, CliBrainId } from './cli-brains';
import { createLocalClient } from './local-client';
import type { LlmClient } from './types';

/**
 * Jarvis is the master; other AIs Sir has set up are brains he can hand work to (delegate_task,
 * NPCs): 'jarvis' = his own connection, 'local' = the Ollama/LM Studio model, every cloud
 * provider with a saved key and model, and Sir's ChatGPT / Google plans through their official
 * apps ('chatgpt', 'antigravity'; answers only, no tools). Several can work at the same time.
 */
export { BRAIN_IDS, type BrainId };

interface BrainDeps {
  settings: SettingsService;
  secrets: Pick<SecretStore, 'get'>;
  catalog(): ToolCatalogEntry[];
  fetch?: typeof fetch;
}

const ALLOWED = CLOUD_PROVIDERS.map((p) => p.baseUrl);

/** An OpenAI-compatible client for one cloud provider (`which` may follow a setting). */
export function createCloudClient(deps: BrainDeps, which: () => CloudProviderId) {
  const p = () => cloudProvider(which());
  return createLocalClient({
    baseUrl: () => p().baseUrl,
    model: () => deps.settings.get('llm.cloud.models')[which()] ?? '',
    catalog: deps.catalog,
    apiKey: () => deps.secrets.get(p().secret),
    cloud: { name: () => p().label, allowedBaseUrls: ALLOWED },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

export const isCliBrain = (id: BrainId): id is CliBrainId =>
  id === 'chatgpt' || id === 'antigravity';

export function createBrains(
  deps: BrainDeps & { jarvis: LlmClient; local: LlmClient; cli: Record<CliBrainId, CliBrain> },
) {
  const clouds = new Map<CloudProviderId, LlmClient>();

  function ready(id: BrainId): boolean {
    if (id === 'jarvis') return true;
    if (id === 'local') return deps.settings.get('llm.local.model') !== '';
    if (isCliBrain(id)) return deps.cli[id].find() !== null;
    return (
      Boolean(deps.secrets.get(cloudProvider(id).secret)) &&
      Boolean(deps.settings.get('llm.cloud.models')[id])
    );
  }

  function label(id: BrainId): string {
    if (id === 'jarvis') return 'Jarvis';
    if (id === 'local') return 'local model';
    if (isCliBrain(id)) return deps.cli[id].label;
    return cloudProvider(id).label;
  }

  return {
    ready,
    label,
    /** Brains set up right now, for messages to Jarvis and Sir. */
    available: (): BrainId[] => BRAIN_IDS.filter(ready),
    /** A subscription app (answers only), or null for brains that run Jarvis's loop. */
    cli: (id: BrainId): CliBrain | null => (isCliBrain(id) ? deps.cli[id] : null),
    /** The client for a brain that runs Jarvis's loop, or null when it isn't set up. */
    get(id: BrainId): LlmClient | null {
      if (!ready(id) || isCliBrain(id)) return null;
      if (id === 'jarvis') return deps.jarvis;
      if (id === 'local') return deps.local;
      let c = clouds.get(id);
      if (!c) {
        c = createCloudClient(deps, () => id);
        clouds.set(id, c);
      }
      return c;
    },
  };
}

export type Brains = ReturnType<typeof createBrains>;
