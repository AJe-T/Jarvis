import { JarvisError } from '../../errors';
import type { Services } from '../../services';
import { handle } from '../handle';

const PREVIEW_CHARS = 300;

/**
 * Clipboard history channels (Security.md §16.17). The renderer gets short previews only; the full
 * text goes straight from the history back to the clipboard, never through the window.
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
  handle('clipboard:clear', () => {
    s.clipboardHistory.clear();
    s.audit.append('user', 'clipboard.clear', {});
    return { ok: true };
  });
}
