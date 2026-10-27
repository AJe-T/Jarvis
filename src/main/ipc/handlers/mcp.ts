import type { McpManager } from '../../mcp/manager';
import { KNOWN_SECRETS } from '@shared/types';
import { CLOUD_PROVIDERS, isConnectionSecret } from '@shared/llm-providers';
import { isCustomSecret } from '@shared/free-pool';
import { MCP_PRESETS } from '@shared/mcp-presets';
import { INTERNAL_SECRET_RE } from '../../settings/secrets';
import type { McpServerInput } from '@shared/ipc-contract';
import { JarvisError } from '../../errors';
import { searchRegistry } from '../../mcp/registry';

/**
 * Keys owned by Jarvis (incl. every AI provider's key and his own internal secrets) or by a vetted
 * preset; only official-trust servers may be bound to them.
 */
const PROTECTED_SECRETS = new Set<string>([
  ...KNOWN_SECRETS,
  ...CLOUD_PROVIDERS.map((p) => p.secret),
  ...MCP_PRESETS.flatMap((p) => (p.secrets ?? []).map((n) => n.name)),
]);
export const isProtectedSecret = (name: string): boolean =>
  PROTECTED_SECRETS.has(name) ||
  INTERNAL_SECRET_RE.test(name) ||
  isConnectionSecret(name) ||
  isCustomSecret(name);

type SecretBinding = {
  trustLevel?: McpServerInput['trustLevel'] | undefined;
  envSecrets?: Record<string, string> | undefined;
  authSecret?: string | undefined;
};

function secretNames(r: SecretBinding): string[] {
  return [...Object.values(r.envSecrets ?? {}), ...(r.authSecret ? [r.authSecret] : [])];
}

/** Security.md §10: a community server can never be handed Sir's GitHub, Notion, Zapier… keys. */
function guardSecrets(r: SecretBinding): void {
  if (r.trustLevel === 'official') return;
  const taken = secretNames(r).find(isProtectedSecret);
  if (taken)
    throw new JarvisError(
      'POLICY_BLOCKED',
      `community server bound to protected secret ${taken}`,
      `This server can't use the "${taken}" key. Give it its own key instead.`,
    );
}
import type { Services } from '../../services';
import { handle } from '../handle';

/** Phase 5 Connections page. Adding/removing servers and loosening tool tiers are audited (Security.md §12). */
export function registerMcpHandlers(s: Services, manager: McpManager): void {
  handle('mcp:list', () => manager.list());
  handle('mcp:add', async (req) => {
    guardSecrets(req);
    await manager.add(req);
    s.audit.append('user', 'mcp.add', {
      name: req.name,
      transport: req.transport,
      command: req.command ?? null,
      url: req.url ?? null,
      args: req.args,
      secrets: secretNames(req), // names only, never values
      trust: req.trustLevel,
    });
    return { ok: true };
  });
  handle('mcp:update', async (req) => {
    const current = manager.list().find((v) => v.id === req.id);
    guardSecrets({ ...current, ...req.patch });
    await manager.update(req.id, req.patch);
    s.audit.append('user', 'mcp.update', { id: req.id, patch: req.patch });
    return { ok: true };
  });
  handle('mcp:remove', async (req) => {
    await manager.remove(req.id);
    s.audit.append('user', 'mcp.remove', { id: req.id });
    return { ok: true };
  });
  handle('mcp:restart', async (req) => {
    await manager.restart(req.id);
    return { ok: true };
  });
  // Read-only lookup; nothing is installed until Sir presses Connect (mcp:add, audited above).
  handle('mcp:registrySearch', (req) => searchRegistry(req));
}
