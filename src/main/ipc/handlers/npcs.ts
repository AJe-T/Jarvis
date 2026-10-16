import { JarvisError } from '../../errors';
import { logger } from '../../logging/logger';
import { memoryPath, NOT_FOR_NPCS, type NpcRuntime } from '../../npcs/npc-runtime';
import type { NpcRepo } from '../../npcs/npc-repo';
import type { Services } from '../../services';
import { handle } from '../handle';

/** Sidebar → NPCs. Every change goes through the runtime (audit, events). */
export function registerNpcHandlers(s: Services, runtime: NpcRuntime, repo: NpcRepo): void {
  const log = logger.child({ module: 'npcs' });
  handle('npcs:list', () => ({
    npcs: repo.list(),
    states: runtime.states(),
    brains: s.brains.available(),
    brainLabels: s.connections.extraLabels(),
    tools: s.registry
      .catalog()
      .filter((t) => !NOT_FOR_NPCS.test(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description.split('. ')[0]?.slice(0, 140) ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const unique = (name: string, id?: string): void => {
    if (repo.list().some((n) => n.id !== id && n.name.toLowerCase() === name.toLowerCase()))
      throw new JarvisError('INVALID', 'npc name taken', `There is already an NPC called ${name}.`);
  };
  handle('npcs:create', (req) => {
    unique(req.name);
    return runtime.create(req);
  });
  handle('npcs:update', async (req) => {
    unique(req.input.name, req.id);
    return runtime.update(req.id, req.input);
  });
  handle('npcs:delete', (req) => {
    runtime.remove(req.id);
    return { ok: true };
  });
  handle('npcs:messages', (req) => runtime.channel(req.channel));
  handle('npcs:send', (req) => {
    // Replies take seconds to minutes; they arrive as npc:message events.
    void runtime
      .send(req.channel, req.text)
      .catch((err: unknown) => log.warn({ err: String(err) }, 'npc send failed'));
    return { ok: true };
  });
  handle('npcs:clear', (req) => {
    repo.clearChannel(req.channel);
    return { ok: true };
  });
  handle('npcs:memory', async (req) => {
    const npc = repo.get(req.id);
    if (!npc) throw new JarvisError('NOT_FOUND', 'npc missing', 'That NPC no longer exists.');
    return { path: memoryPath(npc), markdown: await runtime.memory(npc) };
  });
  handle('npcs:meetings', () => repo.meetings());
  handle('npcs:startMeeting', (req) => runtime.startMeeting(req.topic, req.attendees, req.rounds));
  handle('npcs:stopMeeting', (req) => {
    runtime.stopMeeting(req.id);
    return { ok: true };
  });
}
