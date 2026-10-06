import { describe, expect, it } from 'vitest';
import { ThinkFilter, checkLocalUrl, toOpenAiMessages, toOpenAiTools } from './local-client';

describe('local model client (ADR-013)', () => {
  it('translates tool calls and results to the OpenAI shape', () => {
    const out = toOpenAiMessages(
      [{ type: 'text', text: 'You are JARVIS.' }],
      [
        { role: 'user', content: 'what time is it' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking.' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_datetime', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [{ type: 'text', text: '09:30' }],
            },
            { type: 'text', text: 'and the date?' },
          ],
        },
      ],
    );
    expect(out).toEqual([
      { role: 'system', content: 'You are JARVIS.' },
      { role: 'user', content: 'what time is it' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [
          { id: 'toolu_1', type: 'function', function: { name: 'get_datetime', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: '09:30' },
      { role: 'user', content: 'and the date?' },
    ]);
  });

  it('turns tools into functions, taking schemas from the catalog and dropping API-only tools', () => {
    const tools = toOpenAiTools(
      [
        {
          name: 'get_datetime',
          description: 'Time',
          input_schema: { type: 'object', properties: {} },
        },
        { type: 'memory_20250818', name: 'memory' } as never,
        { type: 'web_search_20260318', name: 'web_search' } as never,
      ],
      () => [{ name: 'memory', description: 'Memory tool', inputSchema: { type: 'object' } }],
    );
    expect(tools.map((t) => t.function.name)).toEqual(['get_datetime', 'memory']);
    expect(tools[1]?.function.description).toBe('Memory tool');
  });

  it('hides <think> reasoning even when tags are split across chunks', () => {
    const f = new ThinkFilter();
    const out = ['Hi <thi', 'nk>secret plan</th', 'ink> there', ' sir']
      .map((d) => f.push(d))
      .join('');
    expect(out).toBe('Hi  there sir');
  });

  it('only accepts servers on this PC or the home network', () => {
    expect(checkLocalUrl('http://localhost:11434/v1').hostname).toBe('localhost');
    expect(checkLocalUrl('http://192.168.1.20:1234/v1').port).toBe('1234');
    expect(() => checkLocalUrl('https://api.example.com/v1')).toThrow();
    expect(() => checkLocalUrl('file:///etc/passwd')).toThrow();
  });
});
