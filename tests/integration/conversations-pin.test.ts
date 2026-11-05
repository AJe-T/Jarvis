import { describe, expect, it } from 'vitest';
import { toSummary } from '@main/db/repos/conversations-repo';
import { setupServices } from './helpers';

const later = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('rename and pin chats (v2.63)', () => {
  it('pinned chats come first on the first page; the cursor pages through the rest', async () => {
    const { services: s } = setupServices({ rules: [] });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(s.conversations.create('text').id);
      await later(5); // distinct last_active_at
    }
    const [oldest, , , newest] = ids as [string, string, string, string];
    s.conversations.setPinned(oldest, true);

    const first = s.conversations.page(2);
    expect(first.rows.map((r) => r.id)).toEqual([oldest, newest, ids[2]]);
    expect(toSummary(first.rows[0]!).pinned).toBe(true);
    expect(toSummary(first.rows[1]!).pinned).toBeUndefined();
    expect(first.nextCursor).toBeDefined();

    const second = s.conversations.page(2, first.nextCursor);
    expect(second.rows.map((r) => r.id)).toEqual([ids[1]]); // the pinned one is not repeated
    expect(second.nextCursor).toBeUndefined();

    s.conversations.setPinned(oldest, false);
    expect(s.conversations.page(10).rows.map((r) => r.id)).toEqual([...ids].reverse());
  });

  it('a rename sticks', () => {
    const { services: s } = setupServices({ rules: [] });
    const c = s.conversations.create('voice');
    s.conversations.setTitle(c.id, 'Trip to Goa');
    expect(toSummary(s.conversations.get(c.id)!).title).toBe('Trip to Goa');
  });
});
