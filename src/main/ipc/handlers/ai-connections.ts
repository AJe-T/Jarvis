import { cloudProvider } from '@shared/llm-providers';
import { JarvisError } from '../../errors';
import type { Services } from '../../services';
import { handle } from '../handle';

const TEST_TIMEOUT_MS = 20_000;

const userError = (err: unknown): string =>
  err instanceof JarvisError && err.userMessage ? err.userMessage : String(err);

/**
 * Integrations step 3: Settings → Brain → Connections. The renderer names connections and models;
 * keys are set through secrets:set by secret name and never come back.
 */
export function registerAiConnectionHandlers(s: Services): void {
  const audit = (event: string, details: Record<string, unknown>): void =>
    s.audit.append('user', event, details);

  handle('ai:connections', () => s.connections.list());

  handle('ai:connection', async (req) => {
    switch (req.action) {
      case 'add': {
        const c = s.connections.add(req.provider, req.label);
        audit('ai.connectionAdd', { id: c.id, provider: c.provider });
        return { ok: true, id: c.id };
      }
      case 'rename':
        s.connections.rename(req.id, req.label);
        return { ok: true };
      case 'setModel':
        s.connections.setModel(req.id, req.model);
        audit('ai.connectionModel', { id: req.id, model: req.model });
        return { ok: true };
      case 'remove':
        s.connections.remove(req.id);
        audit('ai.connectionRemove', { id: req.id });
        return { ok: true };
      case 'refresh': {
        const c = s.connections.get(req.id);
        if (cloudProvider(c.provider).models === 'manual')
          return {
            ok: false,
            error: `${cloudProvider(c.provider).label} publishes no model list: add model ids by hand.`,
          };
        try {
          s.connections.syncLive(req.id, await s.connectionClient(req.id).listModelsDetailed());
          return { ok: true };
        } catch (err) {
          return { ok: false, error: userError(err) };
        }
      }
      case 'test':
        try {
          await s.connectionClient(req.id).ping('', AbortSignal.timeout(TEST_TIMEOUT_MS));
          return { ok: true };
        } catch (err) {
          return { ok: false, error: userError(err) };
        }
      case 'addModel':
        s.connections.addManual(req.id, req.model);
        return { ok: true };
      case 'removeModel':
        s.connections.removeModel(req.id, req.model);
        return { ok: true };
      case 'flags':
        s.connections.setFlags(req.id, req.model, {
          ...(req.favourite !== undefined ? { favourite: req.favourite } : {}),
          ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
        });
        return { ok: true };
    }
  });
}
