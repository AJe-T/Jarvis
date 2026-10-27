import { describe, expect, it } from 'vitest';
import type { LlmRequest } from '../types';
import { estimateTokens, shrinkRequest, TOOL_STUB } from './shrink';

const long = (c: string): string => c.repeat(300);

const req: LlmRequest = {
  model: 'pool',
  max_tokens: 500,
  messages: [
    { role: 'user', content: long('a') },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'fetch_web_page', input: {} }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: long('page ') }],
    },
    { role: 'assistant', content: [{ type: 'text', text: long('a') }] },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't2', name: 'fetch_web_page', input: {} }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't2', content: 'fresh result' }],
    },
    { role: 'user', content: 'What did the page say?' },
  ],
};

describe('prompt shrinking (Phase 4)', () => {
  it('stubs older tool output, drops repeated text, and never touches the last messages', () => {
    const out = shrinkRequest(req);
    const m = out.messages;
    // Older tool output becomes a stub; the newest stays.
    expect(m[2]?.content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: TOOL_STUB }]);
    expect(m[5]).toEqual(req.messages[5]);
    expect(m[6]).toEqual(req.messages[6]);
    // The same long text twice: the recent copy stays, the older one becomes a marker.
    expect(m[0]?.content).toBe('[repeated text removed]');
    expect(m[3]).toEqual(req.messages[3]);
    expect(estimateTokens(out)).toBeLessThan(estimateTokens(req));
  });

  it('cuts very long old text and leaves short requests alone', () => {
    const big: LlmRequest = {
      ...req,
      messages: [{ role: 'user', content: 'x'.repeat(10_000) }, ...req.messages.slice(-4)],
    };
    expect(shrinkRequest(big).messages[0]?.content).toMatch(/cut to fit free limits]$/);
    const tiny: LlmRequest = {
      model: 'pool',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    };
    expect(shrinkRequest(tiny)).toEqual(tiny);
  });
});

describe('estimateTokens', () => {
  it('counts a picture as a fixed amount, not its base64 length', () => {
    const pic: LlmRequest = {
      model: 'pool',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(400_000) },
            },
            { type: 'text', text: 'What is this?' },
          ],
        },
      ],
    };
    const n = estimateTokens(pic);
    expect(n).toBeGreaterThan(1600);
    expect(n).toBeLessThan(2000);
  });
});
