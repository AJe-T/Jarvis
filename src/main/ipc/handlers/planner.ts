import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { JarvisError } from '../../errors';
import type { Planner } from '../../planner/planner';
import { handle } from '../handle';

const MAX_ICS_BYTES = 5 * 1024 * 1024;

/** Tasks and Calendar views (PRD F25/F26). Every change goes through the planner service. */
export function registerPlannerHandlers(planner: Planner): void {
  handle('planner:state', () => ({
    lists: planner.lists(),
    todos: planner.todos(),
    calendars: planner.calendars(),
    events: planner.events(),
  }));
  handle('todos:save', (req) => planner.saveTodo(req));
  handle('todos:delete', (req) => {
    planner.deleteTodo(req.id);
    return { ok: true };
  });
  handle('todos:clearCompleted', () => ({ count: planner.clearCompleted() }));
  handle('todos:saveList', (req) => planner.saveList(req));
  handle('todos:deleteList', (req) => {
    planner.deleteList(req.id);
    return { ok: true };
  });
  handle('calendar:save', (req) => planner.saveEvent(req));
  handle('calendar:delete', (req) => {
    planner.deleteEvent(req.id, req.date, req.scope);
    return { ok: true };
  });
  handle('calendar:saveCalendar', (req) => planner.saveCalendar(req));
  handle('calendar:deleteCalendar', (req) => {
    planner.deleteCalendar(req.id);
    return { ok: true };
  });

  // Sir picks the file in a native dialog, so the renderer never names a path.
  handle('calendar:importIcs', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: 'Import a calendar (.ics)',
      filters: [{ name: 'Calendar', extensions: ['ics'] }],
      properties: ['openFile'] as Array<'openFile'>,
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = r.canceled ? undefined : r.filePaths[0];
    if (!file) return null;
    if ((await stat(file)).size > MAX_ICS_BYTES)
      throw new JarvisError('INVALID', 'ics too large', 'That calendar file is over 5 MB.');
    const { calendar, count, skipped } = planner.importIcs(
      await readFile(file, 'utf8'),
      basename(file, extname(file)),
    );
    return { name: calendar.name, count, skipped };
  });
  handle('calendar:exportIcs', async (req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const cal = planner.calendars().find((c) => c.id === req.calendarId);
    const opts = {
      title: 'Export calendar',
      defaultPath: `${cal?.name ?? 'Jarvis calendar'}.ics`,
      filters: [{ name: 'Calendar', extensions: ['ics'] }],
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { path: null };
    await writeFile(r.filePath, planner.exportIcs(req.calendarId), 'utf8');
    return { path: r.filePath };
  });
}
