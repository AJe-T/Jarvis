import type { ForgeDesk } from '../../forge/desk';
import { handle } from '../handle';

/** Sidebar → Forge: the chat (F9) and Forge's memory, notebooks and chats, read-only (F10). */
export function registerForgeHandlers(desk: ForgeDesk): void {
  handle('forge:messages', () => desk.chat.messages(200));
  // Returns once Sir's message is saved; the desk's reply comes as a forge:message event.
  handle('forge:send', (req) => desk.chat.send(req.text, 'text'));
  handle('forge:files', (req) => desk.store.list(req.dir));
  handle('forge:file', async (req) => ({
    path: req.path,
    markdown: await desk.store.read(req.path),
  }));
}
