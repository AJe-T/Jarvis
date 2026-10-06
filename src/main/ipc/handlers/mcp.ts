import type { McpManager } from '../../mcp/manager';
import type { Services } from '../../services';
import { handle } from '../handle';

/** Phase 5 Connections page. Adding/removing servers and loosening tool tiers are audited (Security.md §12). */
export function registerMcpHandlers(s: Services, manager: McpManager): void {
  handle('mcp:list', () => manager.list());
  handle('mcp:add', async (req) => {
    await manager.add(req);
    s.audit.append('user', 'mcp.add', {
      name: req.name,
      transport: req.transport,
      command: req.command ?? null,
      url: req.url ?? null,
      trust: req.trustLevel,
    });
    return { ok: true };
  });
  handle('mcp:update', async (req) => {
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
}
