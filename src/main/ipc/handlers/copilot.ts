import type { Copilot } from '../../copilot/copilot';
import { handle } from '../handle';

/** Reply copilot (idea from jev-chat-jarvis). Filling pastes into the chat; nothing is ever sent. */
export function registerCopilotHandlers(c: Copilot): void {
  handle('copilot:capture', () => c.capture());
  handle('copilot:analyse', (req) => c.analyse(req.id, req.scene, req.relationship, req.dispute));
  handle('copilot:draft', (req) => c.draft(req.id, req.optionId, req.details));
  handle('copilot:quick', (req) => c.quick(req.id, req.scene, req.relationship));
  handle('copilot:refine', async (req) => ({
    text: await c.refine(req.id, req.text, req.how, req.language),
  }));
  handle('copilot:fill', async (req) => {
    await c.fill(req.id, req.text);
    return { ok: true };
  });
}
