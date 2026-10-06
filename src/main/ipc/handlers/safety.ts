import { writeFileSync } from 'node:fs';
import { BrowserWindow, dialog } from 'electron';
import { JarvisError } from '../../errors';
import type { Services } from '../../services';
import { handle } from '../handle';

/** Phase 2 channels: confirmations, audit log, reminders list. */
export function registerSafetyHandlers(s: Services): void {
  handle('confirm:respond', (req) => {
    if (!s.broker.respond(req.requestId, req.decision, req.via)) {
      throw new JarvisError(
        'NOT_FOUND',
        'no such pending confirmation',
        'That confirmation is no longer waiting.',
      );
    }
    return { ok: true };
  });

  handle('audit:list', (req) => ({
    items: s.audit.list(req.limit, req.beforeSeq).map((r) => ({
      seq: r.seq,
      ts: r.ts,
      actor: r.actor,
      event: r.event,
      details: r.details_json,
    })),
  }));
  handle('audit:verify', () => s.audit.verify());
  handle('audit:export', async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: 'Export audit log',
      defaultPath: `jarvis-audit-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { path: null };
    writeFileSync(
      r.filePath,
      JSON.stringify(
        { exportedAt: new Date().toISOString(), verify: s.audit.verify(), entries: s.audit.all() },
        null,
        2,
      ),
    );
    s.audit.append('user', 'audit.export', { path: r.filePath });
    return { path: r.filePath };
  });

  handle('reminders:list', () =>
    s.reminders
      .recent(50)
      .map((r) => ({ id: r.id, text: r.text, dueAt: r.due_at, status: r.status })),
  );
}
