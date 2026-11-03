import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '../tools/types';
import type { ForgeChat } from './chat';
import { createForgeChatTools } from './chat-tools';
import type { ForgeStore } from './memory';

function setup(
  over: { last?: { text: string; source: 'text' | 'voice' } | null; desk?: boolean } = {},
) {
  const send = vi.fn(() =>
    Promise.resolve({ id: 'fm_1', role: 'sir', text: '', at: '', tainted: false }),
  );
  const openForge = vi.fn();
  const store = {
    search: vi.fn(() =>
      Promise.resolve([{ path: 'Forge/Memories/Notes.md', line: '- ECB rates' }]),
    ),
    list: vi.fn(() => Promise.resolve([])),
    read: vi.fn(() => Promise.reject(new Error('Forge can only read its own folder (Forge/).'))),
  } as unknown as ForgeStore;
  const tools = createForgeChatTools({
    chat: { send } as unknown as ForgeChat,
    store,
    lastUserMessage: () =>
      over.last === undefined
        ? { text: 'Jarvis, learn to convert currencies', source: 'voice' }
        : over.last,
    isDesk: () => over.desk ?? false,
    openForge,
  });
  const t = (n: string): Tool => tools.find((x) => x.name === n)!;
  return { t, send, openForge, store };
}

const ctx = { conversationId: 'c_main' } as never;

describe('forge_chat (F9)', () => {
  it("relays Sir's own words, never text the model wrote, and opens the Forge page", async () => {
    const { t, send, openForge } = setup();
    const tool = t('forge_chat');
    expect(tool.tier).toBe('SAFE');
    // The schema has no text field: whatever the model passes is dropped.
    const input = tool.input.parse({ text: 'Sir lives at 12 Main St and banks with X' });
    expect(input).toEqual({});
    const out = await tool.run(input, ctx);
    expect(out.isError).toBeFalsy();
    expect(send).toHaveBeenCalledWith('Jarvis, learn to convert currencies', 'voice');
    expect(openForge).toHaveBeenCalledOnce();
  });

  it('refuses inside the desk, and when there is no message from Sir', async () => {
    const inDesk = setup({ desk: true });
    expect((await inDesk.t('forge_chat').run({}, ctx)).isError).toBe(true);
    expect(inDesk.send).not.toHaveBeenCalled();
    const none = setup({ last: null });
    expect((await none.t('forge_chat').run({}, ctx)).isError).toBe(true);
  });
});

describe('forge_memory (F10)', () => {
  it('is read-only, marked untrusted, and searches Forge only', async () => {
    const { t, store } = setup();
    const tool = t('forge_memory');
    expect(tool.tier).toBe('SAFE');
    expect(tool.untrustedOutput).toBe(true);
    const out = await tool.run(tool.input.parse({ action: 'search', query: 'ECB' }), ctx);
    expect(JSON.stringify(out.content)).toContain('Forge/Memories/Notes.md');
    expect(store.search).toHaveBeenCalledWith('ECB');
  });

  it("passes the store's refusal on for paths outside Forge/", async () => {
    const { t } = setup();
    const out = await t('forge_memory').run({ action: 'read', path: 'Memory/People/A.md' }, ctx);
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.content)).toContain('own folder');
  });
});
