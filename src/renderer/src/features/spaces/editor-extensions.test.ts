// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { editorExtensions } from './editor-extensions';
import { BLOCK_COMMANDS, matchCommands, slashQuery } from './rich-editor';

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

/** Markdown → editor → Markdown, as a Spaces page is opened and saved. */
function roundTrip(md: string): string {
  editor = new Editor({ extensions: editorExtensions(), content: md, contentType: 'markdown' });
  return editor.getMarkdown();
}

describe('Spaces editor keeps pages as Markdown', () => {
  it.each([
    ['# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code`.'],
    ['## Second\n\n### Third'],
    ['- one\n- two'],
    ['1. first\n2. second'],
    ['- [ ] open task\n- [x] done task'],
    ['> a quote'],
    ['```ts\nconst a = 1;\n```'],
    ['A [link](https://example.com) here.'],
    ['See [[Other note]] and [[Projects/Plan]].'],
    ['---'],
    ['| A | B |\n| --- | --- |\n| 1 | 2 |'],
    ['my_file_name and 2 * 3 cost $5 [not a link]'],
    ['Line one\n\nLine two'],
  ])('%s', (md) => {
    // Tables come back with aligned columns; the same table, so spaces are compared loosely.
    expect(roundTrip(md).trim().replace(/ {2,}/g, ' ')).toBe(md);
  });

  it.each([['Tom & Jerry <3 and a -> b'], ['snake_case_name, C:\\Users and ~/home']])(
    'plain text stays as typed: %s',
    (md) => {
      expect(roundTrip(md).trim()).toBe(md);
    },
  );

  it('text that only looks like Markdown stays literal', () => {
    editor = new Editor({ extensions: editorExtensions() });
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '*not bold* <b> &amp; [[x]] a_ b' }] },
      ],
    });
    const md = editor.getMarkdown();
    editor.commands.setContent(md, { contentType: 'markdown' });
    expect(editor.getText()).toBe('*not bold* <b> &amp; [[x]] a_ b');
  });

  it('a wiki link is one chip in the editor', () => {
    roundTrip('Go to [[Reading list]].');
    const types: string[] = [];
    editor?.state.doc.descendants((n) => void types.push(n.type.name));
    expect(types).toContain('wikiLink');
  });
});

describe('"/" block menu', () => {
  it.each([
    ['/', ''],
    ['Notes /hea', 'hea'],
    ['/heading 1', 'heading 1'],
    ['and/or', null],
    ['no slash', null],
  ])('slashQuery(%s) → %s', (before, q) => expect(slashQuery(before)).toBe(q));

  it('finds commands by name or alias', () => {
    expect(matchCommands('').length).toBe(BLOCK_COMMANDS.length);
    expect(matchCommands('h1').map((c) => c.id)).toEqual(['h1']);
    expect(matchCommands('check').map((c) => c.id)).toEqual(['todo']);
    expect(matchCommands('list').map((c) => c.id)).toEqual(['bullet', 'numbered', 'todo']);
    expect(matchCommands('zzz')).toEqual([]);
  });
});
