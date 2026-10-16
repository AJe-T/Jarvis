import { describe, expect, it } from 'vitest';
import { contextStats, splitHistory } from '@main/agent/context-stats';
import type { MessageRow } from '@main/db/repos/conversations-repo';
import { idle, setupServices } from './helpers';

const row = (
  seq: number,
  role: 'user' | 'assistant',
  content: unknown,
  extra: Partial<MessageRow> = {},
): MessageRow => ({
  id: `m${seq}`,
  conversation_id: 'c',
  seq,
  role,
  content_json: JSON.stringify(content),
  text_plain: '',
  source: role === 'user' ? 'text' : 'text',
  model: null,
  stop_reason: null,
  created_at: '2026-10-15T00:00:00Z',
  ...extra,
});

describe('context meter (idea from LibreChat)', () => {
  it('splits dialogue from tool traffic', () => {
    const rows = [
      row(1, 'user', [{ type: 'text', text: 'x'.repeat(400) }]),
      row(2, 'assistant', [
        { type: 'tool_use', id: 't', name: 'read', input: { p: 'y'.repeat(392) } },
      ]),
      row(3, 'user', [{ type: 'tool_result', tool_use_id: 't', content: 'z'.repeat(4000) }], {
        source: 'system',
      }),
    ];
    const s = splitHistory(rows);
    expect(s.dialogue).toBe(100);
    expect(s.tools).toBeGreaterThan(1000);
  });

  it('uses the last measured request after the summary point, else estimates', () => {
    const rows = [
      row(1, 'user', [{ type: 'text', text: 'hello' }]),
      row(2, 'assistant', [{ type: 'text', text: 'hi' }], {
        input_tokens: 5000,
        cache_read_tokens: 20_000,
        cache_write_tokens: 1000,
      }),
    ];
    const measured = contextStats(rows, 0, 9000);
    expect(measured).toMatchObject({ usedTokens: 26_000, estimated: false, messages: 2 });
    expect(measured.otherTokens).toBe(26_000 - measured.dialogueTokens - measured.toolTokens);

    // After a compaction the old measurement no longer describes what will be sent.
    const compacted = contextStats(rows, 2, 9000);
    expect(compacted).toMatchObject({
      usedTokens: 9000,
      estimated: true,
      messages: 0,
      summarizedMessages: 2,
    });
  });

  it('/compact folds the conversation into its summary and the next turn starts light', async () => {
    const t = setupServices({
      rules: [
        // Rules are tried in order: the compaction prompt has to come before the chat rules.
        { system: 'Summarise this whole conversation', steps: [{ text: 'Sir asked two things.' }] },
        { match: 'first', steps: [{ text: 'Reply one.' }] },
        { match: 'second', steps: [{ text: 'Reply two.' }] },
        { match: 'third', steps: [{ text: 'Reply three.' }] },
      ],
    });
    const s = t.services;
    const { conversationId } = s.orchestrator.send({ text: 'first question', source: 'text' });
    await idle(s);
    s.orchestrator.send({ conversationId, text: 'second question', source: 'text' });
    await idle(s);
    expect(s.orchestrator.contextStats(conversationId).messages).toBe(4);

    const r = await s.orchestrator.compact(conversationId);
    expect(r.summarizedMessages).toBe(4);
    const conv = s.conversations.get(conversationId);
    expect(conv?.summary).toBe('Sir asked two things.');
    expect(s.orchestrator.contextStats(conversationId)).toMatchObject({
      messages: 0,
      summarizedMessages: 4,
      estimated: true,
    });
    // A late background summary can't move the summary point back.
    s.conversations.setSummary(conversationId, 'stale', 2);
    expect(s.conversations.get(conversationId)?.summary).toBe('Sir asked two things.');

    s.orchestrator.send({ conversationId, text: 'third question', source: 'text' });
    await idle(s);
    expect(s.context.history(conversationId)).toHaveLength(2);
    expect(await s.orchestrator.compact(conversationId)).toEqual({ summarizedMessages: 2 });
  });
});
