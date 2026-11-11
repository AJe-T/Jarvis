import { JarvisError } from '../../errors';
import type { Services } from '../../services';
import { handle } from '../handle';

const PREVIEW_CHARS = 300;

/**
 * Clipboard history, day timeline, undo and screen memory channels (Security.md §16.17,
 * §16.18, §16.21, §16.22). The renderer gets
 * short clipboard previews only; the full text goes straight from the history back to the
 * clipboard, never through the window.
 */
export function registerClipboardHandlers(s: Services): void {
  handle('clipboard:history', () =>
    s.clipboardHistory
      .list()
      .map((i) => ({ id: i.id, preview: i.text.slice(0, PREVIEW_CHARS), at: i.at })),
  );
  handle('clipboard:restore', async (req) => {
    const item = s.clipboardHistory.get(req.id);
    if (!item)
      throw new JarvisError('INVALID', 'clip gone', 'That copy is no longer in the history.');
    await s.os.clipboardWrite(item.text);
    return { ok: true };
  });
  // Day timeline (Security.md §16.18).
  handle('timeline:day', (req) => s.timeline.day(req.day));
  handle('timeline:clear', () => {
    s.timeline.clear();
    s.audit.append('user', 'timeline.clear', {});
    return { ok: true };
  });
  // Screen memory (Security.md §16.22): the window gets snippets; a full capture goes straight
  // to the clipboard inside the main process.
  handle('screen:search', (req) => s.screenMemory.search(req.query, 6));
  handle('screen:copy', async (req) => {
    const text = s.screenMemory.text(req.id);
    if (text === undefined)
      throw new JarvisError('INVALID', 'capture gone', 'That capture is no longer kept.');
    await s.os.clipboardWrite(text);
    return { ok: true };
  });
  handle('screen:clear', () => {
    s.screenMemory.clear();
    s.audit.append('user', 'screenMemory.clear', {});
    return { ok: true };
  });
  // Undo (Security.md §16.21): the id makes sure the action taken back is the one Sir was shown.
  handle('undo:peek', () => s.undo.last() ?? null);
  handle('undo:run', async (req) => {
    const done = await s.undo.undoLast(req.id);
    if (!done)
      return { ok: false, message: 'That is no longer the last action, so nothing was undone.' };
    s.audit.append('user', 'undo.run', { label: done.label, ok: done.ok });
    return {
      ok: done.ok,
      message: done.ok
        ? `Undid "${done.label}". ${done.result}`
        : `Could not undo "${done.label}": ${done.result}`,
    };
  });
  handle('clipboard:clear', () => {
    s.clipboardHistory.clear();
    s.audit.append('user', 'clipboard.clear', {});
    return { ok: true };
  });
}
