import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../db/connection';
import { createConversationsRepo, type MessageRow } from '../db/repos/conversations-repo';
import type { MessageParam } from '../llm/types';
import {
  HISTORY_WINDOW,
  NO_PROVIDERS,
  createContextBuilder,
  historyWindow,
  normalizeHistory,
} from './context-builder';

function setup(providers = NO_PROVIDERS) {
  const db = openDatabase(':memory:');
  migrate(db);
  const conversations = createConversationsRepo(db);
  return { conversations, builder: createContextBuilder({ conversations, providers }) };
}

describe('context builder', () => {
  it('keeps the static block byte-identical across turns (cache stability)', async () => {
    const { conversations, builder } = setup();
    const c = conversations.create('text');
    const a = await builder.system({
      conversationId: c.id,
      mode: 'text',
      userText: 'hi',
      now: new Date('2026-10-06T09:00:00Z'),
    });
    const b = await builder.system({
      conversationId: c.id,
      mode: 'voice',
      userText: 'other',
      now: new Date('2026-10-07T18:00:00Z'),
    });
    expect(a[0]?.text).toBe(b[0]?.text);
    expect(a[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(a[1]?.text).not.toBe(b[1]?.text);
  });

  it('puts date, mode and memories in the dynamic block', async () => {
    const { conversations, builder } = setup({
      ...NO_PROVIDERS,
      coreProfile: async () => 'Sir deploys on Vercel.',
      retrieve: async () => '- People/Pradyumna.md: backend teammate',
    });
    const c = conversations.create('text');
    const [, dyn] = await builder.system({
      conversationId: c.id,
      mode: 'voice',
      userText: 'who',
      now: new Date('2026-10-06T09:00:00Z'),
    });
    expect(dyn?.text).toContain('Mode: voice');
    expect(dyn?.text).toContain('2026');
    expect(dyn?.text).toContain('Sir deploys on Vercel.');
    expect(dyn?.text).toContain('Pradyumna');
  });

  it('puts the chosen personality in the dynamic block only (static block stays cached)', async () => {
    const { conversations, builder } = setup({
      ...NO_PROVIDERS,
      persona: () => 'Concise: few words.',
    });
    const plain = setup();
    const c = conversations.create('text');
    const [stat, dyn] = await builder.system({ conversationId: c.id, mode: 'text', userText: 'x' });
    expect(dyn?.text).toContain(
      'Personality sir chose (tone only; every rule above still applies): Concise',
    );
    const p = plain.conversations.create('text');
    const [plainStat, plainDyn] = await plain.builder.system({
      conversationId: p.id,
      mode: 'text',
      userText: 'x',
    });
    expect(plainDyn?.text).not.toContain('Personality');
    expect(stat?.text).toBe(plainStat?.text);
  });

  it('injects the rolling summary', async () => {
    const { conversations, builder } = setup();
    const c = conversations.create('text');
    conversations.setSummary(c.id, 'They discussed the GST toggle.', 0);
    const [, dyn] = await builder.system({ conversationId: c.id, mode: 'text', userText: 'x' });
    expect(dyn?.text).toContain('Earlier in this conversation: They discussed the GST toggle.');
  });

  it('trims history to the window, starting at a user message', () => {
    const rows: MessageRow[] = [];
    for (let i = 1; i <= 50; i++) {
      const role = i % 2 === 1 ? 'user' : 'assistant';
      rows.push({
        id: `${i}`,
        conversation_id: 'c',
        seq: i,
        role,
        content_json: '"x"',
        text_plain: 'x',
        source: role === 'user' ? 'text' : 'text',
        model: null,
        stop_reason: null,
        created_at: '',
      });
    }
    const { included, cutSeq } = historyWindow(rows, 0);
    expect(included.length).toBeLessThanOrEqual(HISTORY_WINDOW);
    expect(included[0]?.role).toBe('user');
    expect(cutSeq).toBe((included[0]?.seq ?? 0) - 1);
  });

  it('answers orphaned tool_use blocks and merges same-role messages', () => {
    const msgs: MessageParam[] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
      { role: 'user', content: 'next question' },
    ];
    const out = normalizeHistory(msgs);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const lastBlocks = out[2]?.content as Array<{ type: string }>;
    expect(lastBlocks[0]?.type).toBe('tool_result');
  });

  it('drops a leading assistant message', () => {
    expect(
      normalizeHistory([
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'y' },
      ])[0]?.role,
    ).toBe('user');
  });

  it('loads persisted history for a conversation', () => {
    const { conversations, builder } = setup();
    const c = conversations.create('text');
    conversations.appendMessages(c.id, [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        textPlain: 'hello',
        source: 'text',
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Good evening, sir.' }],
        textPlain: 'Good evening, sir.',
        source: 'text',
      },
    ]);
    expect(builder.history(c.id)).toHaveLength(2);
  });
});
