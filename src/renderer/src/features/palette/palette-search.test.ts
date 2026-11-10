import { describe, expect, it } from 'vitest';
import { groupItems, localItems, matchItems, type PaletteSources } from './palette-search';

const sources: PaletteSources = {
  views: [
    { view: 'tasks', label: 'Tasks' },
    { view: 'passwords', label: 'Passwords' },
  ],
  settings: [{ id: 'voice', label: 'Voice', keywords: 'microphone wake word' }],
  todos: [
    { id: 't1', title: 'Pay the electricity bill', status: 'todo', dueDate: '2026-11-12' },
    { id: 't2', title: 'Pay rent', status: 'done', dueDate: null },
  ],
  events: [{ id: 'e1', title: 'Dentist', start: '2026-11-13T16:00' }],
  spaces: [{ name: 'Finance', pages: ['Bills 2026'] }],
  chats: [{ id: 'c1', title: null }],
};

describe('command palette search', () => {
  it('opens as a menu: only actions and screens when nothing is typed', () => {
    const groups = new Set(matchItems(localItems(sources), '  ').map((i) => i.group));
    expect([...groups]).toEqual(['Actions', 'Go to']);
  });

  it('finds a task, a Spaces page and a setting by any of their words', () => {
    const items = localItems(sources);
    expect(matchItems(items, 'bill').map((i) => i.id)).toEqual([
      'todo:t1',
      'space:Finance/Bills 2026',
    ]);
    expect(matchItems(items, 'bill pay')[0]?.run).toEqual({ kind: 'todo', id: 't1' });
    // A setting is found by what Sir would type, not only by its label.
    expect(matchItems(items, 'microphone')[0]?.run).toEqual({
      kind: 'view',
      view: 'settings',
      section: 'voice',
    });
  });

  it('leaves finished tasks out and opens a page inside its Space', () => {
    const items = localItems(sources);
    expect(matchItems(items, 'rent')).toEqual([]);
    expect(matchItems(items, 'bills 2026')[0]?.run).toEqual({
      kind: 'view',
      view: 'spaces',
      section: 'Finance/Bills 2026',
    });
  });

  it('lists clipboard copies by their text or by "clipboard", and offers to clear them', () => {
    const items = localItems({
      ...sources,
      clips: [{ id: 7, preview: 'https://avaan.example/invoice/4471\nsecond line' }],
    });
    expect(matchItems(items, '4471')[0]).toMatchObject({
      group: 'Clipboard',
      label: 'https://avaan.example/invoice/4471',
      run: { kind: 'clip', id: 7 },
    });
    expect(matchItems(items, 'clipboard').map((i) => i.run.kind)).toEqual(['clearClips', 'clip']);
    // Nothing from the clipboard in the opening menu, and no clear action without copies.
    expect(matchItems(items, '').some((i) => i.run.kind === 'clearClips')).toBe(false);
    expect(localItems(sources).some((i) => i.run.kind === 'clearClips')).toBe(false);
  });

  it('caps each group at six, drops repeats and puts labels that start with the query first', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `chat:${i}`,
      group: 'Chats' as const,
      label: i === 8 ? 'Invoice for Avaan' : `About the invoice ${i}`,
      run: { kind: 'chat' as const, id: String(i) },
    }));
    const out = groupItems([...many, many[0]!], 'invoice');
    expect(out).toHaveLength(6);
    expect(out[0]?.label).toBe('Invoice for Avaan');
  });
});
