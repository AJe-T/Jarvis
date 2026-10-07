import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, shell } from 'electron';
import { backupNow, listBackups } from '../../db/connection';
import { JarvisError } from '../../errors';
import { tailLog } from '../../logging/log-tail';
import type { Services } from '../../services';
import { handle } from '../handle';

/** Phase 7: backups, restore (applied on restart), data folders. Database.md §7. */
export function registerDataHandlers(s: Services): void {
  const backups = join(s.userData, 'backups');

  handle('db:backups', () => listBackups(backups));
  handle('db:backupNow', () => {
    backupNow(s.db, backups);
    s.audit.append('user', 'db.backup', {});
    return { ok: true };
  });
  handle('db:restore', (req) => {
    if (!listBackups(backups).some((b) => b.file === req.file))
      throw new JarvisError('NOT_FOUND', 'no such backup', 'That backup no longer exists.');
    s.audit.append('user', 'db.restore', { file: req.file });
    // Keep the current data outside the rotating backup set, so pruning can't remove the restore source.
    const safety = join(s.userData, 'pre-restore.db');
    rmSync(safety, { force: true });
    s.db.prepare('VACUUM INTO ?').run(safety);
    writeFileSync(join(s.userData, 'restore-pending.json'), JSON.stringify({ file: req.file }));
    // The open database can't be replaced in place: restart, and the restore runs before it opens.
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 300);
    return { ok: true };
  });
  handle('logs:tail', (req) => tailLog(join(s.userData, 'logs'), req.lines).catch(() => []));
  handle('app:openFolder', async (req) => {
    const target = {
      userData: s.userData,
      logs: join(s.userData, 'logs'),
      backups,
      vault: s.settings.get('vault.path'),
    }[req.which];
    const err = await shell.openPath(target);
    if (err) throw new JarvisError('NOT_FOUND', err, `Couldn't open the folder: ${err}`);
    return { ok: true };
  });
}

/** Settings → Privacy "delete chat history older than N days" (0 = keep forever). */
export function applyRetention(s: Services): void {
  const days = s.settings.get('retention.messagesDays');
  if (days <= 0) return;
  const removed = s.conversations.deleteMessagesOlderThan(
    new Date(Date.now() - days * 86_400_000).toISOString(),
  );
  if (removed) s.audit.append('system', 'retention.cleanup', { removed, days });
}
