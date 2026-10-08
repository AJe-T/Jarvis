import type { Spaces } from '../../spaces/spaces';
import { emit } from '../emit';
import { handle } from '../handle';

/** Spaces view channels. Pages are plain Markdown in the vault, so Obsidian sees the same files. */
export function registerSpacesHandlers(spaces: Spaces, ui: { show(): void }): void {
  handle('spaces:list', () => spaces.list());
  handle('spaces:create', async (req) => {
    await spaces.create(req.name, req.icon);
    return { ok: true };
  });
  handle('spaces:update', async (req) => {
    await spaces.update(req.name, req.next);
    return { ok: true };
  });
  handle('spaces:delete', async (req) => {
    await spaces.remove(req.name);
    return { ok: true };
  });
  handle('spaces:pages', (req) => spaces.pages(req.space));
  handle('spaces:read', (req) => spaces.read(req.space, req.page));
  handle('spaces:write', (req) =>
    spaces.write(req.space, req.page, req.markdown, req.expectedHash),
  );
  handle('spaces:createPage', async (req) => ({
    name: await spaces.createPage(req.space, req.title, req.template),
  }));
  handle('spaces:renamePage', async (req) => {
    await spaces.renamePage(req.space, req.page, req.next);
    return { ok: true };
  });
  handle('spaces:deletePage', async (req) => {
    await spaces.removePage(req.space, req.page);
    return { ok: true };
  });
  handle('spaces:open', (req) => {
    emit('nav:open', {
      view: 'spaces',
      section: req.page ? `${req.space}/${req.page}` : req.space,
    });
    ui.show();
    return { ok: true };
  });
}
