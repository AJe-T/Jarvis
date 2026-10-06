import { BrowserWindow, dialog } from 'electron';
import type { Services } from '../../services';
import type { Skill } from '../../skills/skills';
import { handle } from '../handle';

const view = (s: Skill) => ({
  name: s.name,
  description: s.description,
  license: s.license ?? null,
  enabled: s.enabled,
  files: s.files,
});

/** Settings → Skills. The folder is chosen in a main-process dialog, never passed in by the renderer. */
export function registerSkillHandlers(s: Services): void {
  const changed = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await s.refreshSkills();
    return r;
  };
  handle('skills:list', async () => (await s.skills.list()).map(view));
  handle('skills:read', async (req) => ({ markdown: await s.skills.read(req.name) }));
  handle('skills:installFolder', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: 'Choose a skill folder (with SKILL.md)',
      properties: ['openDirectory'] as Array<'openDirectory'>,
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const folder = r.canceled ? null : r.filePaths[0];
    if (!folder) return { skill: null };
    const skill = await changed(s.skills.installFromFolder(folder));
    s.audit.append('user', 'skill.install', { name: skill.name, from: 'folder' });
    return { skill: view(skill) };
  });
  handle('skills:installGitHub', async (req) => {
    const skill = await changed(s.skills.installFromGitHub(req.url));
    s.audit.append('user', 'skill.install', { name: skill.name, from: req.url });
    return { skill: view(skill) };
  });
  handle('skills:remove', async (req) => {
    await changed(s.skills.remove(req.name));
    s.audit.append('user', 'skill.remove', { name: req.name });
    return { ok: true };
  });
  handle('skills:setEnabled', (req) => {
    s.skills.setEnabled(req.name, req.enabled);
    return { ok: true };
  });
}
