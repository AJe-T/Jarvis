import {
  BRAIN_IDS,
  CLOUD_PROVIDERS,
  CONNECTION_ID_RE,
  cloudProvider,
  defaultConnectionId,
  type BrainId,
  type BrainRef,
  type CloudProviderDef,
  type CloudProviderId,
} from '@shared/llm-providers';
import type { ToolCatalogEntry } from '../agent/agent-loop';
import type { SecretStore } from '../settings/secrets';
import type { SettingsService } from '../settings/settings-service';
import type { CliBrain, CliBrainId } from './cli-brains';
import type { Connections } from './connections';
import { createLocalClient } from './local-client';
import type { LlmClient } from './types';

/**
 * Jarvis is the master; other AIs Sir has set up are brains he can hand work to (delegate_task,
 * NPCs): 'jarvis' = his own connection, 'local' = the Ollama/LM Studio model, every cloud
 * provider with a saved key and model, Sir's extra keys (conn_openai_2…), and his ChatGPT /
 * Google plans through their official apps ('chatgpt', 'antigravity'; answers only, no tools).
 * Several can work at the same time.
 */
export { BRAIN_IDS, type BrainId, type BrainRef };

interface BrainDeps {
  settings: SettingsService;
  secrets: Pick<SecretStore, 'get'>;
  connections: Connections;
  catalog(): ToolCatalogEntry[];
  fetch?: typeof fetch;
}

const ALLOWED = CLOUD_PROVIDERS.map((p) => p.baseUrl);
const MODEL_URLS = CLOUD_PROVIDERS.flatMap((p: CloudProviderDef) =>
  p.modelsUrl ? [p.modelsUrl] : [],
);

/** An OpenAI-compatible client for one connection (`connection` may follow a setting). */
export function createCloudClient(deps: BrainDeps, connection: () => string) {
  const target = () => deps.connections.target(connection());
  const p = () => cloudProvider(target().provider);
  return createLocalClient({
    baseUrl: () => p().baseUrl,
    model: () => target().model,
    catalog: deps.catalog,
    apiKey: () => deps.secrets.get(target().secret),
    cloud: {
      name: () => {
        const t = target();
        return t.label === p().label ? t.label : `${p().label} (${t.label})`;
      },
      allowedBaseUrls: ALLOWED,
      allowedModelUrls: MODEL_URLS,
      listing: () => ({ kind: p().models, url: p().modelsUrl }),
      tag: () => connection(),
    },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

export const isCliBrain = (id: BrainRef): id is CliBrainId =>
  id === 'chatgpt' || id === 'antigravity';

const isConnection = (id: BrainRef): id is `conn_${string}` => CONNECTION_ID_RE.test(id);
const isCloud = (id: BrainRef): id is CloudProviderId => CLOUD_PROVIDERS.some((p) => p.id === id);

export function createBrains(
  deps: BrainDeps & { jarvis: LlmClient; local: LlmClient; cli: Record<CliBrainId, CliBrain> },
) {
  const clouds = new Map<string, LlmClient>();
  /** A provider name means its own key; a conn_ id one of Sir's keys. */
  const connectionOf = (id: BrainRef): string | null =>
    isConnection(id) ? id : isCloud(id) ? defaultConnectionId(id) : null;

  function ready(id: BrainRef): boolean {
    if (id === 'jarvis') return true;
    if (id === 'local') return deps.settings.get('llm.local.model') !== '';
    if (isCliBrain(id)) return deps.cli[id].find() !== null;
    const conn = connectionOf(id);
    if (!conn) return false;
    try {
      const t = deps.connections.target(conn);
      return Boolean(deps.secrets.get(t.secret)) && t.model !== '';
    } catch {
      return false; // a removed or unknown connection
    }
  }

  function label(id: BrainRef): string {
    if (id === 'jarvis') return 'Jarvis';
    if (id === 'local') return 'local model';
    if (isCliBrain(id)) return deps.cli[id].label;
    if (isCloud(id)) return cloudProvider(id).label;
    try {
      const t = deps.connections.target(id);
      return `${cloudProvider(t.provider).label} (${t.label})`;
    } catch {
      return id;
    }
  }

  /** Sir's extra keys that are ready (the providers' own keys are the provider names). */
  const extraReady = (): BrainRef[] =>
    deps.connections
      .ready()
      .filter((c) => !c.primary)
      .map((c) => c.id as `conn_${string}`);

  return {
    ready,
    label,
    /** Brains set up right now, for messages to Jarvis and Sir. */
    available: (): BrainRef[] => [...BRAIN_IDS.filter(ready), ...extraReady()],
    /** A subscription app (answers only), or null for brains that run Jarvis's loop. */
    cli: (id: BrainRef): CliBrain | null => (isCliBrain(id) ? deps.cli[id] : null),
    /** Another provider's paid API (not Jarvis's own connection nor the local model). */
    paid: (id: BrainRef): boolean => connectionOf(id) !== null,
    /** The client for a brain that runs Jarvis's loop, or null when it isn't set up. */
    get(id: BrainRef): LlmClient | null {
      if (!ready(id) || isCliBrain(id)) return null;
      if (id === 'jarvis') return deps.jarvis;
      if (id === 'local') return deps.local;
      const conn = connectionOf(id) as string;
      let c = clouds.get(conn);
      if (!c) {
        c = createCloudClient(deps, () => conn);
        clouds.set(conn, c);
      }
      return c;
    },
  };
}

export type Brains = ReturnType<typeof createBrains>;
