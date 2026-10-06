import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { backupNow, listBackups } from '@main/db/connection';
import { createFakeClaude } from '@main/llm/fake-claude';
import { createServices } from '@main/services';
import { createFakeOs } from '@main/tools/native/os';
import { fakeEncryptor, setupServices } from './helpers';

vi.mock('electron', () => ({ app: {}, shell: {} }));
const { applyRetention } = await import('@main/ipc/handlers/data');

const msg = (text: string) => ({
  role: 'user' as const,
  content: text,
  textPlain: text,
  source: 'text' as const,
});

function reopen(dir: string) {
  return createServices({
    userData: join(dir, 'data'),
    isTest: true,
    encryptor: fakeEncryptor,
    emit: () => undefined,
    llm: createFakeClaude({ rules: [] }),
    os: createFakeOs(),
    home: join(dir, 'home'),
    paths: { documents: dir, desktop: dir, downloads: dir, pictures: dir, videos: dir, music: dir },
  });
}

describe('phase 7 data management (Database.md §7)', () => {
  it('retention deletes only messages older than the setting', () => {
    const { services: s } = setupServices();
    const c = s.conversations.create('text');
    s.conversations.appendMessages(c.id, [msg('old'), msg('new')]);
    s.db
      .prepare(
        "UPDATE messages SET created_at = '2020-01-01T00:00:00.000Z' WHERE text_plain = 'old'",
      )
      .run();

    s.settings.set('retention.messagesDays', 0);
    applyRetention(s);
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n).toBe(2);

    s.settings.set('retention.messagesDays', 30);
    applyRetention(s);
    const left = s.db.prepare('SELECT text_plain FROM messages').all() as Array<{
      text_plain: string;
    }>;
    expect(left.map((r) => r.text_plain)).toEqual(['new']);
    expect(s.audit.all().some((a) => a.event === 'retention.cleanup')).toBe(true);
  });

  it('a pending restore replaces the database on the next start', () => {
    const { dir, services: s } = setupServices();
    s.conversations.create('text');
    const backups = join(dir, 'data', 'backups');
    const file = backupNow(s.db, backups, new Date('2026-01-02T03:04:00Z'));
    s.conversations.create('text');
    expect(s.conversations.list(10)).toHaveLength(2);

    writeFileSync(
      join(dir, 'data', 'restore-pending.json'),
      JSON.stringify({ file: file.split(/[\\/]/).at(-1) }),
    );
    s.db.close();
    const after = reopen(dir);
    expect(after.conversations.list(10)).toHaveLength(1);
    expect(existsSync(join(dir, 'data', 'restore-pending.json'))).toBe(false);
    expect(listBackups(backups).length).toBeGreaterThan(0);
    after.db.close();
  });
});
