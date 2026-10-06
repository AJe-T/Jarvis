import { describe, expect, it, vi } from 'vitest';
import { EVENTS, INVOKE } from '@shared/ipc-contract';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc-channels';

const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
vi.mock('electron', () => ({
  app: { isPackaged: true },
  session: {},
  shell: {},
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, raw: unknown) => Promise<unknown>) =>
      handlers.set(ch, fn),
    on: vi.fn(),
  },
}));
const { handle } = await import('@main/ipc/handle');

describe('IPC contract', () => {
  it('has a schema for every channel', () => {
    for (const ch of INVOKE_CHANNELS) expect(INVOKE[ch]).toBeDefined();
    for (const ev of EVENT_CHANNELS) expect(EVENTS[ev]).toBeDefined();
  });

  it('rejects malformed chat:send payloads', () => {
    const schema = INVOKE['chat:send'].request;
    expect(schema.safeParse({ text: '', source: 'text' }).success).toBe(false);
    expect(schema.safeParse({ text: 'x'.repeat(20_001), source: 'text' }).success).toBe(false);
    expect(schema.safeParse({ text: 'hi', source: 'telepathy' }).success).toBe(false);
    expect(schema.safeParse({ text: 'hi', source: 'text' }).success).toBe(true);
  });

  it('rejects unknown settings keys and bad secret names', () => {
    expect(INVOKE['settings:set'].request.safeParse({ key: 'evil.key', value: 1 }).success).toBe(
      false,
    );
    expect(INVOKE['secrets:set'].request.safeParse({ name: '../x', value: 'v' }).success).toBe(
      false,
    );
  });
});

describe('handle()', () => {
  const trusted = { senderFrame: { url: 'file:///C:/app/out/renderer/index.html' } };
  const untrusted = { senderFrame: { url: 'https://evil.example/' } };

  it('runs handlers for the app frame with a parsed request', async () => {
    handle('chat:cancel', () => ({ ok: true }));
    await expect(handlers.get('chat:cancel')?.(trusted, {})).resolves.toEqual({ ok: true });
  });

  it('refuses calls from other frames', async () => {
    handle('app:killSwitch', () => ({ ok: true }));
    await expect(handlers.get('app:killSwitch')?.(untrusted, {})).rejects.toThrow();
  });

  it('refuses invalid payloads before the handler runs', async () => {
    const fn = vi.fn(() => ({ conversationId: 'c', turnId: 't' }));
    handle('chat:send', fn);
    await expect(handlers.get('chat:send')?.(trusted, { text: 42 })).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses responses that break the contract', async () => {
    handle('usage:summary', () => ({ costUsd: 'lots' }) as never);
    await expect(handlers.get('usage:summary')?.(trusted, { range: 'day' })).rejects.toThrow();
  });
});
