import { Extension, Node, mergeAttributes, nodeInputRule, type AnyExtension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

/**
 * Spaces pages stay plain Markdown files in the Obsidian vault; this is the editor's view of them
 * (Notion-style blocks, "/" commands, Ctrl+B …). Everything here must survive a Markdown round trip,
 * which `editor-extensions.test.ts` checks.
 */

/** `[[Another note]]`: Obsidian's link between notes, kept as one chip so it saves back verbatim. */
export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { target: { default: '' } };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
        getAttrs: (el) => ({ target: el.dataset['wikilink'] ?? '' }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': node.attrs['target'] as string,
        class: 'wikilink',
      }),
      node.attrs['target'] as string,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs['target'] as string}]]`;
  },

  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize: (src: string) => {
      const m = /^\[\[([^[\]\n]{1,200})\]\]/.exec(src);
      return m ? { type: 'wikiLink', raw: m[0], target: m[1] } : undefined;
    },
  },

  parseMarkdown: (token) => ({
    type: 'wikiLink',
    attrs: { target: typeof token['target'] === 'string' ? token['target'] : '' },
  }),

  renderMarkdown: (node) => `[[${String(node.attrs?.['target'] ?? '')}]]`,

  addInputRules() {
    // Typing [[Note name]] turns into a link chip.
    return [
      nodeInputRule({
        find: /\[\[([^[\]\n]{1,200})\]\]$/,
        type: this.type,
        getAttributes: (m) => ({ target: m[1] }),
      }),
    ];
  },
});

/**
 * Escapes only what would really change meaning when the page is read back, so a note saved from the
 * editor still reads cleanly in Obsidian: "my_file & 2 * 3 [draft]" stays as it is, while "*word*"
 * typed as plain text, "<b>", "&amp;" and "[[x]]" are escaped. (The stock serializer escapes every
 * _ * [ ] ~ and turns & into &amp;.)
 */
export function minimalEscape(text: string): string {
  const alnum = /[\p{L}\p{N}]/u;
  const linky = /\]\s*[([]/.test(text);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    const prev = text[i - 1] ?? ' ';
    const next = text[i + 1] ?? ' ';
    if (c === '\\') out += /[!-/:-@[-`{-~]/.test(next) ? '\\\\' : '\\';
    else if (c === '&') out += /^&(#\d+|#x[\da-f]+|\w+);/i.test(text.slice(i)) ? '&amp;' : '&';
    else if (c === '<') out += /[A-Za-z/!?]/.test(next) ? '&lt;' : '<';
    else if (c === '`') out += '\\`';
    else if (c === '*') out += /\s/.test(prev) && /\s/.test(next) ? '*' : '\\*';
    else if (c === '_') out += alnum.test(prev) && alnum.test(next) ? '_' : '\\_';
    else if (c === '~') out += next === '~' || prev === '~' ? '\\~' : '~';
    else if (c === '[') out += next === '[' || prev === '[' || linky ? '\\[' : '[';
    else out += c;
  }
  return out;
}

/** Swaps the serializer's text escaping for minimalEscape (code keeps its text untouched, as before). */
const CleanMarkdownText = Extension.create({
  name: 'cleanMarkdownText',
  onBeforeCreate() {
    const m = (this.editor as unknown as { markdown?: MarkdownTextEncoder }).markdown;
    if (!m) return;
    const stock = m.encodeTextForMarkdown.bind(m);
    m.encodeTextForMarkdown = (text, node, parent) =>
      // The stock encoder leaves code untouched; anything it would escape is plain text.
      stock(text, node, parent) === text ? text : minimalEscape(text);
  },
});

interface MarkdownTextEncoder {
  encodeTextForMarkdown(text: string, node: unknown, parent: unknown): string;
}

export function editorExtensions(placeholder = ''): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Plain Markdown has no underline; Obsidian would show "<u>" tags, so Ctrl+U is left out.
      underline: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    WikiLink,
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : placeholder),
    }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    CleanMarkdownText,
  ];
}
