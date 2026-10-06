import { createMcpRepo } from '../db/repos/mcp-repo';
import { logger } from '../logging/logger';
import type { Services } from '../services';
import { createMcpManager } from './manager';

/** Phase 5 composition: MCP servers become tools (via a registry provider) and context ("Connected integrations"). */
export function createMcpSystem(
  s: Services,
  opts: { appVersion: string; extraEnv?: Record<string, string> },
) {
  const repo = createMcpRepo(s.db);
  const manager = createMcpManager({
    repo,
    secret: (name) => s.secrets.get(name),
    allowedRoots: () => s.settings.get('files.allowedRoots'),
    userData: s.userData,
    appVersion: opts.appVersion,
    emit: (e, p) => s.emit(e, p),
    logger,
    ...(opts.extraEnv ? { extraEnv: opts.extraEnv } : {}),
  });
  s.registry.addProvider(() => manager.tools());
  s.slots.providers = { ...s.slots.providers, integrations: () => manager.integrationsSummary() };
  return { repo, manager };
}

export type McpSystem = ReturnType<typeof createMcpSystem>;
