import type { Services } from '../../services';
import { handle } from '../handle';

/** Integrations step 4: Sidebar → Compare AIs. */
export function registerRunHandlers(s: Services): void {
  // Forge F7: the run history page (Sidebar → Forge). Read-only.
  handle('forge:runs', () => s.forge.history());
  // Jarvis's own connection comes first (BRAIN_IDS order): what Sir compares the others against.
  handle('runs:brains', () =>
    s.brains.available().map((id) => ({
      id,
      label: id === 'jarvis' ? 'Jarvis (main connection)' : s.brains.label(id),
    })),
  );
  handle('runs:estimate', (req) => s.multiRun.estimate(req));
  handle('runs:start', (req) => {
    const run = s.multiRun.start(req.request, req.acceptUsd);
    // Which AIs got the prompt, not the prompt itself.
    s.audit.append('user', 'runs.start', {
      id: run.id,
      mode: run.mode,
      brains: run.steps.map((st) => st.brain),
    });
    return run;
  });
  handle('runs:cancel', (req) => {
    s.multiRun.cancel(req.id);
    return { ok: true };
  });
  handle('runs:list', () => s.multiRun.list());
  handle('runs:remove', (req) => {
    s.multiRun.remove(req.id);
    return { ok: true };
  });
  handle('runs:clear', () => ({ removed: s.multiRun.clear() }));
}
