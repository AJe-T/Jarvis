import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeOs } from '@main/tools/native/os';
import { setupServices } from './helpers';

/** The one clipboard both Electron (the password handlers) and the OS adapter (the history) see. */
const clip = vi.hoisted(() => ({ text: '' }));
const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
vi.mock('electron', () => ({
  app: { isPackaged: true },
  session: {},
  shell: {},
  dialog: {},
  powerMonitor: { on: vi.fn() },
  clipboard: {
    readText: () => Promise.resolve(clip.text),
    writeText: (t: string) => {
      clip.text = t;
      return Promise.resolve();
    },
    clear: () => {
      clip.text = '';
    },
  },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) =>
      handlers.set(ch, fn),
    on: vi.fn(),
  },
}));
const { registerPasswordHandlers } = await import('@main/ipc/handlers/passwords');
const { registerPlannerHandlers } = await import('@main/ipc/handlers/planner');
const { registerSafetyHandlers } = await import('@main/ipc/handlers/safety');

const trusted = { senderFrame: { url: 'file:///C:/app/out/renderer/index.html' } };
const call = <T = unknown>(channel: string, req: unknown = {}): Promise<T> => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(trusted, req) as Promise<T>;
};

function setup() {
  const os = createFakeOs();
  const t = setupServices({ rules: [] }, { os: { ...os, clipboardRead: async () => clip.text } });
  return { ...t, s: t.services };
}

beforeEach(() => {
  handlers.clear();
  clip.text = '';
});

describe('IPC handlers: passwords', () => {
  it('set up, save, list without secrets, copy, lock; every step audited without the entry', async () => {
    const { s } = setup();
    registerPasswordHandlers(s);
    expect(await call('passwords:status')).toEqual({ exists: false, unlocked: false, count: 0 });
    await call('passwords:setup', { master: 'correct horse battery' });
    const saved = await call<{ id: string }>('passwords:save', {
      title: 'Bank',
      username: 'sir',
      password: 'hunter2-very-secret',
    });
    const list = await call<Array<Record<string, unknown>>>('passwords:list');
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('hunter2');

    const copied = await call<{ clearsInSeconds: number }>('passwords:copy', {
      id: saved.id,
      field: 'password',
    });
    expect(copied.clearsInSeconds).toBe(20);
    expect(clip.text).toBe('hunter2-very-secret');

    await call('passwords:lock');
    expect(await call('passwords:status')).toMatchObject({ exists: true, unlocked: false });
    await expect(call('passwords:list')).rejects.toThrow();
    await expect(call('passwords:unlock', { master: 'wrong' })).rejects.toThrow();
    await call('passwords:unlock', { master: 'correct horse battery' });

    const audit = s.audit.list(20);
    expect(audit.map((a) => a.event)).toEqual(
      expect.arrayContaining([
        'passwords.setup',
        'passwords.save',
        'passwords.unlockFailed',
        'passwords.unlock',
      ]),
    );
    expect(JSON.stringify(audit)).not.toMatch(/hunter2|Bank/);
    // Three key derivations (setup, failed unlock, unlock): over 5 s when the whole suite runs.
  }, 30_000);

  it('a copied password never enters the clipboard history', async () => {
    const { s } = setup();
    registerPasswordHandlers(s);
    s.settings.set('clipboard.history', true);
    await s.clipboardHistory.poll(); // first look
    await call('passwords:setup', { master: 'correct horse battery' });
    const saved = await call<{ id: string }>('passwords:save', {
      title: 'Mail',
      password: 'plain-looking-words',
    });
    await call('passwords:copy', { id: saved.id, field: 'password' });
    await s.clipboardHistory.poll();
    expect(s.clipboardHistory.list()).toEqual([]);
    // Sir's own next copy is kept as usual.
    clip.text = 'meeting notes';
    await s.clipboardHistory.poll();
    expect(s.clipboardHistory.list().map((i) => i.text)).toEqual(['meeting notes']);
  });
});

describe('IPC handlers: tasks, calendar and safety', () => {
  it('planner: save, change, delete and read back; bad input refused', async () => {
    const { s } = setup();
    registerPlannerHandlers(s.planner);
    const todo = await call<{ id: string; title: string }>('todos:save', {
      title: 'Pay rent',
      dueDate: '2026-11-12',
    });
    await call('todos:save', { id: todo.id, status: 'done' });
    const ev = await call<{ id: string }>('calendar:save', {
      title: 'Dentist',
      start: '2026-11-12T16:00',
      end: '2026-11-12T17:00',
    });
    const state = await call<{ todos: Array<{ status: string }>; events: unknown[] }>(
      'planner:state',
    );
    expect(state.todos.map((t) => t.status)).toEqual(['done']);
    expect(state.events).toHaveLength(1);
    expect(await call('todos:clearCompleted')).toEqual({ count: 1 });
    expect(await call('calendar:delete', { id: ev.id })).toEqual({ ok: true });
    await expect(call('todos:save', { title: '' })).rejects.toThrow();
    await expect(call('calendar:save', { title: 'x', start: 'tomorrow' })).rejects.toThrow();
    await expect(call('todos:delete', { id: 'not-an-id' })).rejects.toThrow();
  });

  it('safety: the audit log lists newest first and its chain verifies; a stale confirmation is refused', async () => {
    const { s } = setup();
    registerSafetyHandlers(s);
    s.audit.append('user', 'test.one', { n: 1 });
    s.audit.append('user', 'test.two', { n: 2 });
    const { items } = await call<{ items: Array<{ event: string; seq: number }> }>('audit:list', {
      limit: 2,
    });
    expect(items.map((i) => i.event)).toEqual(['test.two', 'test.one']);
    expect(await call('audit:verify')).toMatchObject({ ok: true });
    await expect(call('audit:list', { limit: 5000 })).rejects.toThrow();
    await expect(
      call('confirm:respond', { requestId: 'req_gone', decision: 'approve', via: 'click' }),
    ).rejects.toThrow(/no longer waiting/);
    expect(await call('reminders:list')).toEqual([]);
  });
});
