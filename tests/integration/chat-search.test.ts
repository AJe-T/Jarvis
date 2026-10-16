import { describe, expect, it } from 'vitest';
import { idle, setupServices } from './helpers';

describe('search all chats (idea from LibreChat)', () => {
  it('finds past chats as you type, one hit per chat, private ones included', async () => {
    const t = setupServices({
      rules: [
        { match: 'kubernetes', steps: [{ text: 'Kubernetes schedules containers.' }] },
        { match: 'pasta', steps: [{ text: 'Boil the pasta for nine minutes.' }] },
      ],
    });
    const s = t.services;
    const a = s.orchestrator.send({ text: 'explain kubernetes pods', source: 'text' });
    await idle(s);
    s.orchestrator.send({
      conversationId: a.conversationId,
      text: 'more on kubernetes',
      source: 'text',
    });
    await idle(s);
    const b = s.orchestrator.send({ text: '/private how long to cook pasta', source: 'text' });
    await idle(s);

    const kube = s.conversations.searchChats('kuber');
    expect(kube.map((h) => h.conversationId)).toEqual([a.conversationId]);
    expect(kube[0]?.snippet).toMatch(/\[Kubernetes\]|\[kubernetes\]/);

    // Private chats stay out of Jarvis's own recall but Sir can find them.
    expect(s.conversations.searchChats('pasta').map((h) => h.conversationId)).toEqual([
      b.conversationId,
    ]);
    expect(s.conversations.searchMessages('"pasta"', 10)).toEqual([]);

    // All words first; any word when nothing has them all.
    expect(s.conversations.searchChats('kubernetes pasta')).toHaveLength(2);
    expect(s.conversations.searchChats('the and')).toEqual([]);
  });
});
