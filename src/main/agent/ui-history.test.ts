import { describe, expect, it } from 'vitest';
import type { UiToolCall } from '@shared/types';
import type { MessageRow } from '../db/repos/conversations-repo';
import { buildUiMessages, displayText } from './ui-history';

let seq = 0;
function row(
  role: 'user' | 'assistant',
  content: unknown,
  extra: Partial<MessageRow> = {},
): MessageRow {
  seq++;
  return {
    id: `m${seq}`,
    conversation_id: 'c1',
    seq,
    role,
    content_json: JSON.stringify(content),
    text_plain: '',
    source: role === 'user' ? 'text' : null,
    model: null,
    stop_reason: null,
    created_at: `2026-10-06T10:00:0${seq % 10}.000Z`,
    ...extra,
  };
}

describe('buildUiMessages', () => {
  it('folds one turn (text, tool use, tool result, more text) into one Jarvis bubble', () => {
    const call = { id: 'tc1', toolUseId: 'tu1', toolName: 'open_app' } as unknown as UiToolCall;
    const rows = [
      row('user', 'open notepad', { source: 'voice' }),
      row('assistant', [
        { type: 'text', text: '<spoken>On it.</spoken>' },
        { type: 'tool_use', id: 'tu1', name: 'open_app', input: {} },
        { type: 'tool_use', id: 'unknown', name: 'x', input: {} },
      ]),
      row('user', [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }], {
        source: 'system',
      }),
      row(
        'assistant',
        [
          {
            type: 'text',
            text: 'Done.',
            citations: [
              { type: 'web_search_result_location', url: 'https://a.example', title: null },
              { type: 'web_search_result_location', url: 'https://a.example', title: 'dup' },
              { type: 'char_location' },
            ],
          },
        ],
        { stop_reason: 'interrupted' },
      ),
    ];
    const ui = buildUiMessages(rows, new Map([['tu1', call]]));
    expect(ui).toHaveLength(2);
    expect(ui[0]).toMatchObject({ role: 'user', text: 'open notepad', source: 'voice' });
    expect(ui[1]).toMatchObject({
      role: 'assistant',
      text: 'On it.\n\nDone.',
      toolCalls: [call],
      citations: [{ url: 'https://a.example', title: 'https://a.example' }],
      interrupted: true,
    });
  });

  it('skips system-sourced user rows and starts a new bubble per user message', () => {
    const rows = [
      row('user', 'hi'),
      row('assistant', [{ type: 'text', text: 'Hello.' }]),
      row('user', 'summary', { source: 'system' }),
      row('user', 'again'),
      row('assistant', [{ type: 'text', text: 'Yes?' }]),
    ];
    const ui = buildUiMessages(rows, new Map());
    expect(ui.map((m) => `${m.role}:${m.text}`)).toEqual([
      'user:hi',
      'assistant:Hello.',
      'user:again',
      'assistant:Yes?',
    ]);
  });

  it('displayText drops spoken tags and leading space', () => {
    expect(displayText('  <spoken>Hi</spoken> there')).toBe('Hi there');
  });
});
