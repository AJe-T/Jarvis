import { JarvisError } from '../../errors';
import type { Dock } from '../../apps/dock';
import type { Services } from '../../services';
import { handle } from '../handle';

/** Apps view (ADR-032). Running commands is not here: only the Terminal window can do that. */
export function registerAppHandlers(s: Services, apps: { dock: Dock }): void {
  handle('apps:dock', (req) => {
    apps.dock.place(req.app, req.bounds, req.open);
    return { ok: true };
  });
  handle('apps:timerAdd', (req) => {
    s.scheduler.add(`${req.label} is done.`, new Date(Date.now() + req.seconds * 1000), null);
    return { ok: true };
  });
  handle('apps:timerCancel', (req) => {
    if (!s.scheduler.cancel(req.id))
      throw new JarvisError('NOT_FOUND', 'no timer', 'That timer already finished.');
    return { ok: true };
  });
}
