import { describe, expect, it } from 'vitest';
import { PRIVATE_TOOLS } from '@shared/free-pool';
import { logger } from '../../logging/logger';
import type { ToolContext } from '../types';
import {
  createClipboardHistory,
  createClipboardHistoryTool,
  reportingOwnCopies,
} from './clipboard-history';
import { createFakeOs } from './os';

function setup() {
  const state = { clip: 'copied before it was on', on: true, private: false, now: 1_000_000 };
  const history = createClipboardHistory({
    read: () => Promise.resolve(state.clip),
    isPrivate: () => Promise.resolve(state.private),
    enabled: () => state.on,
    now: () => state.now,
  });
  /** Sir copies something; Jarvis notices on the next look. */
  const copy = async (text: string): Promise<void> => {
    state.clip = text;
    state.now += 2000;
    await history.poll();
  };
  return { state, history, copy };
}

const ctx: ToolContext = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};

describe('clipboard history', () => {
  it('keeps new text copies newest first, without what was there before it was on', async () => {
    const { history, copy } = setup();
    await history.poll();
    expect(history.list()).toEqual([]);
    await copy('first link');
    await copy('second note');
    await copy('first link'); // copied again: it moves to the top, it is not kept twice
    expect(history.list().map((i) => i.text)).toEqual(['first link', 'second note']);
    expect(history.list('NOTE').map((i) => i.text)).toEqual(['second note']);
    expect(history.get(history.list()[0]?.id ?? 0)?.text).toBe('first link');
  });

  it('never keeps a copy marked private, a secret, or one Jarvis made himself', async () => {
    const { state, history, copy } = setup();
    await history.poll();
    state.private = true;
    await copy('from a password manager');
    state.private = false;
    await copy('card 4111 1111 1111 1111');
    history.ignore('generated-password-x9');
    await copy('generated-password-x9');
    await copy('   ');
    await copy('x'.repeat(20_001));
    expect(history.list()).toEqual([]);
    // The "Jarvis made it" mark is used once and expires: Sir copying the same text later is kept.
    state.now += 60_000;
    await copy('something else');
    await copy('generated-password-x9');
    expect(history.list().map((i) => i.text)).toContain('generated-password-x9');
  });

  it('treats a failed privacy check as private, and forgets everything when turned off', async () => {
    const state = { clip: 'a', on: true };
    const history = createClipboardHistory({
      read: () => Promise.resolve(state.clip),
      isPrivate: () => Promise.reject(new Error('powershell failed')),
      enabled: () => state.on,
    });
    await history.poll();
    state.clip = 'b';
    await history.poll();
    expect(history.list()).toEqual([]);

    const { state: s2, history: h2, copy } = setup();
    await h2.poll();
    await copy('kept for now');
    expect(h2.list()).toHaveLength(1);
    s2.on = false;
    await h2.poll();
    s2.on = true;
    expect(h2.list()).toEqual([]);
  });

  it('keeps at most 50 copies', async () => {
    const { history, copy } = setup();
    await history.poll();
    for (let i = 0; i < 55; i++) await copy(`item ${i}`);
    expect(history.list()).toHaveLength(50);
    expect(history.list()[0]?.text).toBe('item 54');
  });

  it('hears about every clipboard write Jarvis makes through the OS adapter', async () => {
    const os = createFakeOs({ psJson: () => ({}), clipboard: '' });
    const seen: string[] = [];
    const wrapped = reportingOwnCopies(os, (t) => seen.push(t));
    await wrapped.clipboardWrite('hunter2');
    await wrapped.pasteText('dictated words');
    expect(seen).toEqual(['hunter2', 'dictated words']);
    expect(os.calls.map((c) => c.op)).toEqual(['clipboardWrite', 'pasteText']);
  });
});

describe('clipboard_history tool', () => {
  it('asks first, marks its output untrusted and private, and lists copies with their age', async () => {
    const { state, history, copy } = setup();
    const tool = createClipboardHistoryTool(history, () => state.now);
    expect(tool.tier).toBe('CONFIRM');
    expect(tool.untrustedOutput).toBe(true);
    expect(PRIVATE_TOOLS['clipboard_history']).toBe('clipboard');
    expect(tool.summarize({ query: 'link', limit: 10 })).toBe('Read clipboard history for "link"');
    expect(tool.input.safeParse({ limit: 99 }).success).toBe(false);

    await history.poll();
    const empty = await tool.run(tool.input.parse({}), ctx);
    expect(JSON.stringify(empty.content)).toMatch(/history is empty/);

    await copy('https://example.com/a');
    state.now += 5 * 60_000;
    const out = await tool.run(tool.input.parse({ query: 'example' }), ctx);
    expect(out.untrustedSource).toBe('clipboard');
    expect(JSON.stringify(out.content)).toContain('[5 min ago] https://example.com/a');
    const none = await tool.run(tool.input.parse({ query: 'nothing-like-it' }), ctx);
    expect(JSON.stringify(none.content)).toMatch(/No recent copy contains/);
  });
});
