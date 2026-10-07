import { describe, expect, it } from 'vitest';
import { idle, setupServices } from './helpers';

describe('chat rewind (idea from isair/jarvis)', () => {
  it('drops the chosen message and everything after it, then the chat continues from there', async () => {
    const t = setupServices({
      rules: [
        { match: 'first', steps: [{ text: 'Reply one.' }] },
        { match: 'second', steps: [{ text: 'Reply two.' }] },
        { match: 'better', steps: [{ text: 'Reply three.' }] },
      ],
    });
    const s = t.services;
    const { conversationId } = s.orchestrator.send({ text: 'first question', source: 'text' });
    await idle(s);
    s.orchestrator.send({ conversationId, text: 'second question', source: 'text' });
    await idle(s);
    s.conversations.setSummary(conversationId, 'covers everything', 99);

    expect(s.conversations.rewind(conversationId, 1)).toBe('second question');
    const left = s.conversations.messages(conversationId).map((m) => m.text_plain);
    expect(left).toEqual(['first question', 'Reply one.']);
    expect(s.conversations.get(conversationId)?.summary).toBeNull();
    expect(s.conversations.rewind(conversationId, 5)).toBeNull();

    s.orchestrator.send({ conversationId, text: 'a better question', source: 'text' });
    await idle(s);
    expect(s.conversations.messages(conversationId).map((m) => m.text_plain)).toEqual([
      'first question',
      'Reply one.',
      'a better question',
      'Reply three.',
    ]);
  });
});
