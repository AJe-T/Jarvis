import { describe, expect, it } from 'vitest';
import { sortConversations } from './chat-store';

describe('Conversations order (v2.63)', () => {
  it('keeps pinned chats on top as chats are updated', () => {
    const at = (m: number): string => `2026-11-06T10:${String(m).padStart(2, '0')}:00Z`;
    const list = sortConversations([
      { id: 'a', title: 'a', lastActiveAt: at(1), source: 'text' },
      { id: 'b', title: 'b', lastActiveAt: at(5), source: 'text' },
      { id: 'p', title: 'p', lastActiveAt: at(0), source: 'text', pinned: true },
    ]);
    expect(list.map((c) => c.id)).toEqual(['p', 'b', 'a']);
  });
});
