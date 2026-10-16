import { describe, expect, it } from 'vitest';
import type { Services } from '../services';
import type { ToolContext } from '../tools/types';
import { recallEarlierTool } from './memory-system';

type Row = ReturnType<Services['conversations']['messages']>[number];

function convs(count: number, summaryUpto: number) {
  const rows: Row[] = Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    conversation_id: 'c1',
    seq: i + 1,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content_json: '[]',
    text_plain:
      i === 2 ? 'The GST number is 29ABCDE1234F1Z5' : i % 2 === 0 ? `question ${i + 1}` : 'answer',
    source: 'text',
    model: null,
    stop_reason: null,
    created_at: `2026-10-15T10:${String(i).padStart(2, '0')}:00.000Z`,
  }));
  return {
    messages: () => rows,
    get: () => ({ summary_upto_seq: summaryUpto }),
  } as unknown as Services['conversations'];
}

const ctx = { conversationId: 'c1' } as ToolContext;
const text = (o: { content: Array<{ type: string; text?: string }> }) =>
  o.content.map((c) => c.text ?? '').join('');

describe('recall_earlier (idea from billion-context)', () => {
  it('says so when nothing is folded away', async () => {
    const out = await recallEarlierTool(convs(6, 0)).run({ limit: 10 }, ctx);
    expect(text(out)).toMatch(/already in view/);
  });

  it('returns folded messages verbatim, matching the query first', async () => {
    const tool = recallEarlierTool(convs(60, 20));
    const hit = text(await tool.run({ query: 'GST number', limit: 3 }, ctx));
    expect(hit).toContain('29ABCDE1234F1Z5');
    expect(hit).toContain('sir:');
    const recent = text(await tool.run({ limit: 2 }, ctx));
    // The window keeps the last 30 rows; the two newest folded ones are seq 29 and 30.
    expect(recent).toContain('question 29');
    expect(recent).not.toContain('question 31');
    expect(text(await tool.run({ query: 'zebra', limit: 3 }, ctx))).toMatch(/No earlier message/);
  });
});
