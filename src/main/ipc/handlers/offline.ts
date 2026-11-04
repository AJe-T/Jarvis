import type { Services } from '../../services';
import { offlineReadiness, type OfflineView } from '../../offline';
import { handle } from '../handle';

/** Offline mode: Settings → Privacy shows what stops it; turning it on re-checks everything first. */
export function registerOfflineHandlers(s: Services, view: OfflineView): void {
  const readiness = () => offlineReadiness(view, (signal) => s.llmLocal.ping('', signal));
  handle('offline:status', async () => ({
    enabled: s.settings.get('offline.enabled'),
    problems: await readiness(),
  }));
  handle('offline:set', async ({ enabled }) => {
    const problems = enabled ? await readiness() : [];
    if (problems.length) return { ok: false, problems };
    s.settings.set('offline.enabled', enabled);
    s.audit.append('user', 'settings.change', { key: 'offline.enabled', value: enabled });
    return { ok: true, problems: [] };
  });
}
