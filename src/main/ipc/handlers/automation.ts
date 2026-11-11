import type { Automation } from '../../automation/automation';
import { schedOf } from '../../automation/automation';
import { describeSchedule, type TaskRow } from '../../automation/tasks';
import { JarvisError } from '../../errors';
import type { Services } from '../../services';
import { emit } from '../emit';
import { handle } from '../handle';

const view = (t: TaskRow) => {
  const schedule = schedOf(t);
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    prompt: t.prompt,
    schedule,
    enabled: t.enabled === 1,
    speak: t.speak === 1,
    saveToVault: t.save_to_vault === 1,
    scheduleText: describeSchedule(schedule),
    nextRunAt: t.next_run_at,
    lastRunAt: t.last_run_at,
    lastStatus: t.last_status,
    lastConversationId: t.last_conversation_id,
  };
};

/** Settings → Automations (scheduled agents, ideas from OpenJarvis). */
export function registerAutomationHandlers(s: Services, a: Automation): void {
  handle('tasks:list', () => a.repo.list().map(view));
  handle('tasks:save', (req) => {
    // A watched folder must be one Sir allowed (the watcher re-checks it on every look).
    if (req.schedule.type === 'newFile' && !s.pathGuard.check(req.schedule.folder).ok)
      throw new JarvisError(
        'INVALID',
        'folder not allowed',
        'That folder is not inside your allowed folders (Settings → Files).',
      );
    const t = a.repo.upsert(req);
    s.audit.append('user', 'task.save', { id: t.id, name: t.name, enabled: req.enabled });
    emit('tasks:changed', {});
    return { task: view(t) };
  });
  handle('tasks:delete', (req) => {
    a.repo.remove(req.id);
    s.audit.append('user', 'task.delete', { id: req.id });
    emit('tasks:changed', {});
    return { ok: true };
  });
  handle('tasks:runNow', (req) => {
    const conversationId = a.runNow(req.id);
    if (!conversationId)
      throw new JarvisError('NOT_FOUND', 'no task', 'That task no longer exists.');
    emit('tasks:changed', {});
    return { conversationId };
  });
}
