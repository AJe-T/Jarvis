import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeOs } from '@main/tools/native/os';
import { setupServices } from './helpers';

/** Every handler registered through ipc/handle.ts, as the renderer would reach it. */
const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
vi.mock('electron', () => ({
  app: { isPackaged: true },
  session: {},
  shell: {},
  dialog: {},
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) =>
      handlers.set(ch, fn),
    on: vi.fn(),
  },
}));
const { registerClipboardHandlers } = await import('@main/ipc/handlers/clipboard');
const { registerAutomationHandlers } = await import('@main/ipc/handlers/automation');
const { createAutomation } = await import('@main/automation/automation');

const trusted = { senderFrame: { url: 'file:///C:/app/out/renderer/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };
const call = <T = unknown>(channel: string, req: unknown = {}): Promise<T> => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn(trusted, req) as Promise<T>;
};

function setup() {
  // The bare fake stands for Sir (and other apps); services wrap it to know Jarvis's own copies.
  const sir = createFakeOs({
    psJson: () => ({ lines: ['Quarterly invoice 4471 is overdue', 'Total: 18,200 rupees'] }),
    clipboard: 'copied before the history was on',
    foreground: { title: 'Invoices - Excel', process: 'EXCEL', hwnd: 5, pid: 7 },
  });
  const t = setupServices({ rules: [] }, { os: sir });
  return { ...t, sir, s: t.services };
}

beforeEach(() => handlers.clear());

describe('IPC handlers: clipboard history, day timeline, screen memory, undo', () => {
  it('clipboard: previews only, restore copies the full text back, clear empties and is audited', async () => {
    const { s, sir } = setup();
    registerClipboardHandlers(s);
    s.settings.set('clipboard.history', true);
    await s.clipboardHistory.poll(); // first look: notes what is there
    const long = `https://avaan.example/invoice/4471 ${'x'.repeat(400)}`;
    await sir.clipboardWrite(long);
    await s.clipboardHistory.poll();

    const list = await call<Array<{ id: number; preview: string }>>('clipboard:history');
    expect(list).toHaveLength(1);
    expect(list[0]?.preview).toHaveLength(300); // the window never gets the whole text
    await sir.clipboardWrite('something else');
    expect(await call('clipboard:restore', { id: list[0]?.id })).toEqual({ ok: true });
    expect(await sir.clipboardRead()).toBe(long);
    await expect(call('clipboard:restore', { id: 999 })).rejects.toThrow(
      /no longer in the history/,
    );
    await expect(call('clipboard:restore', { id: 'x' })).rejects.toThrow();

    expect(await call('clipboard:clear')).toEqual({ ok: true });
    expect(await call('clipboard:history')).toEqual([]);
    expect(s.audit.list(5).some((a) => a.event === 'clipboard.clear')).toBe(true);
  });

  it('never keeps what Jarvis copies himself, even through the handlers', async () => {
    const { s } = setup();
    registerClipboardHandlers(s);
    s.settings.set('clipboard.history', true);
    await s.clipboardHistory.poll();
    await s.os.clipboardWrite('a generated password'); // Jarvis's own adapter
    await s.clipboardHistory.poll();
    expect(await call('clipboard:history')).toEqual([]);
  });

  it('day timeline: one day of app time, a bad date refused, clear deletes it', async () => {
    const { s } = setup();
    registerClipboardHandlers(s);
    s.settings.set('timeline.enabled', true);
    await s.timeline.sample();
    await s.timeline.sample();
    const day = await call<{ totalSeconds: number; apps: Array<{ process: string }> }>(
      'timeline:day',
    );
    expect(day.totalSeconds).toBe(120);
    expect(day.apps.map((a) => a.process)).toEqual(['EXCEL']);
    await expect(call('timeline:day', { day: 'yesterday' })).rejects.toThrow();
    expect(await call('timeline:clear')).toEqual({ ok: true });
    expect((await call<{ apps: unknown[] }>('timeline:day')).apps).toEqual([]);
  });

  it('screen memory: snippets to the window, the full text only to the clipboard', async () => {
    const { s, sir } = setup();
    registerClipboardHandlers(s);
    s.settings.set('screenMemory.enabled', true);
    expect(await s.screenMemory.capture()).toBe('saved');
    const hits = await call<Array<{ id: number; process: string; snippet: string }>>(
      'screen:search',
      { query: 'invoice 4471' },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ process: 'EXCEL' });
    expect(await call('screen:copy', { id: hits[0]?.id })).toEqual({ ok: true });
    expect(await sir.clipboardRead()).toContain('Total: 18,200 rupees');
    await expect(call('screen:search', { query: 'a' })).rejects.toThrow();
    await expect(call('screen:copy', { id: 999 })).rejects.toThrow(/no longer kept/);
    expect(await call('screen:clear')).toEqual({ ok: true });
    expect(await call('screen:search', { query: 'invoice' })).toEqual([]);
  });

  it('undo: only the action Sir was shown is taken back', async () => {
    const { s } = setup();
    registerClipboardHandlers(s);
    expect(await call('undo:peek')).toBeNull();
    let undone = 0;
    s.undo.record('Move a.txt to Archive', () => {
      undone++;
      return Promise.resolve('Moved it back.');
    });
    const shown = await call<{ id: number; label: string }>('undo:peek');
    expect(shown.label).toBe('Move a.txt to Archive');
    s.undo.record('Rename b.txt', () => Promise.resolve('Renamed back.'));
    // A newer action arrived after the dialog was shown: nothing is undone.
    expect(await call('undo:run', { id: shown.id })).toMatchObject({ ok: false });
    expect(undone).toBe(0);
    const latest = await call<{ id: number }>('undo:peek');
    expect(await call('undo:run', { id: latest.id })).toEqual({
      ok: true,
      message: 'Undid "Rename b.txt". Renamed back.',
    });
    expect(s.audit.list(5).some((a) => a.event === 'undo.run')).toBe(true);
  });

  it('refuses every one of them from a page that is not the app', async () => {
    const { s } = setup();
    registerClipboardHandlers(s);
    for (const ch of ['clipboard:history', 'timeline:day', 'screen:clear', 'undo:peek'])
      await expect(handlers.get(ch)?.(untrusted, {})).rejects.toThrow();
  });
});

describe('IPC handlers: automations', () => {
  const task = (schedule: unknown) => ({
    name: 'Sort downloads',
    kind: 'task',
    prompt: 'Tell me what this file is.',
    schedule,
    enabled: true,
    speak: false,
    saveToVault: false,
  });

  it('saves, lists and deletes; a watched folder must be inside the allowed folders', async () => {
    const { s } = setup();
    registerAutomationHandlers(s, createAutomation(s));
    const allowed = s.settings.get('files.allowedRoots')[0] ?? '';
    const saved = await call<{ task: { id: string; scheduleText: string } }>(
      'tasks:save',
      task({ type: 'newFile', folder: allowed }),
    );
    expect(saved.task.scheduleText).toBe(`when a file appears in ${allowed}`);
    await expect(
      call('tasks:save', task({ type: 'newFile', folder: 'C:\\Windows\\System32' })),
    ).rejects.toThrow(/not inside your allowed folders/);
    await expect(call('tasks:save', task({ type: 'beforeEvent', minutes: 1 }))).rejects.toThrow();

    expect(await call<unknown[]>('tasks:list')).toHaveLength(1);
    await expect(call('tasks:runNow', { id: 'task_missing' })).rejects.toThrow(/no longer exists/);
    expect(await call('tasks:delete', { id: saved.task.id })).toEqual({ ok: true });
    expect(await call('tasks:list')).toEqual([]);
    expect(s.audit.list(10).map((a) => a.event)).toEqual(
      expect.arrayContaining(['task.save', 'task.delete']),
    );
  });
});
