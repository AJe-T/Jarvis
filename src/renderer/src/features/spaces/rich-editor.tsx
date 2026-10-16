import { useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  Bold,
  CheckSquare,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Keyboard,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table,
  Type,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { IconButton } from '../../components/ui/button';
import { editorExtensions } from './editor-extensions';

/** One "/" command: what it is, how to find it, its shortcut, what it does. */
export interface BlockCommand {
  id: string;
  label: string;
  hint: string;
  /** Extra words that find it ("h1", "checkbox"…). */
  aliases: string[];
  keys?: string;
  Icon: LucideIcon;
  run(e: Editor): void;
}

export const BLOCK_COMMANDS: BlockCommand[] = [
  {
    id: 'text',
    label: 'Text',
    hint: 'Plain writing',
    aliases: ['paragraph', 'normal'],
    Icon: Type,
    keys: 'Ctrl+Alt+0',
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Big section title',
    aliases: ['h1', 'title'],
    Icon: Heading1,
    keys: 'Ctrl+Alt+1',
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Medium heading',
    aliases: ['h2', 'subtitle'],
    Icon: Heading2,
    keys: 'Ctrl+Alt+2',
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Small heading',
    aliases: ['h3'],
    Icon: Heading3,
    keys: 'Ctrl+Alt+3',
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    hint: 'A simple list',
    aliases: ['ul', 'bullet', 'points'],
    Icon: List,
    keys: 'Ctrl+Shift+8',
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'numbered',
    label: 'Numbered list',
    hint: '1, 2, 3…',
    aliases: ['ol', 'ordered', 'number'],
    Icon: ListOrdered,
    keys: 'Ctrl+Shift+7',
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'To-do list',
    hint: 'Tick boxes',
    aliases: ['task', 'checkbox', 'check'],
    Icon: CheckSquare,
    keys: 'Ctrl+Shift+9',
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Set text apart',
    aliases: ['blockquote', 'citation'],
    Icon: Quote,
    keys: 'Ctrl+Shift+B',
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: 'Code, monospaced',
    aliases: ['pre', 'snippet'],
    Icon: Code2,
    keys: 'Ctrl+Alt+C',
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'A line between sections',
    aliases: ['hr', 'line', 'separator'],
    Icon: Minus,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'table',
    label: 'Table',
    hint: '3 × 3 grid',
    aliases: ['grid'],
    Icon: Table,
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'page',
    label: 'Link to a page',
    hint: 'Type the page name, then ]]',
    aliases: ['wiki', 'note', 'mention', '[['],
    Icon: Link2,
    run: (e) => e.chain().focus().insertContent('[[').run(),
  },
];

/** "/hea" right before the cursor (at the start of a line or after a space), not inside code. */
export function slashQuery(textBefore: string): string | null {
  const m = /(?:^|\s)\/([\p{L}\p{N} [-]{0,24})$/u.exec(textBefore);
  return m ? (m[1] ?? '') : null;
}

export function matchCommands(query: string): BlockCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_COMMANDS;
  return BLOCK_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.aliases.some((a) => a.startsWith(q)),
  );
}

const INLINE: Array<{
  label: string;
  keys: string;
  Icon: LucideIcon;
  mark: string;
  run(e: Editor): void;
}> = [
  {
    label: 'Bold',
    keys: 'Ctrl+B',
    Icon: Bold,
    mark: 'bold',
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: 'Italic',
    keys: 'Ctrl+I',
    Icon: Italic,
    mark: 'italic',
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: 'Strikethrough',
    keys: 'Ctrl+Shift+S',
    Icon: Strikethrough,
    mark: 'strike',
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    label: 'Inline code',
    keys: 'Ctrl+E',
    Icon: Code,
    mark: 'code',
    run: (e) => e.chain().focus().toggleCode().run(),
  },
];

const TOOLBAR_BLOCKS = [
  'h1',
  'h2',
  'bullet',
  'numbered',
  'todo',
  'quote',
  'code',
  'table',
  'divider',
];

function isActive(e: Editor, id: string): boolean {
  switch (id) {
    case 'h1':
    case 'h2':
    case 'h3':
      return e.isActive('heading', { level: Number(id[1]) });
    case 'bullet':
      return e.isActive('bulletList');
    case 'numbered':
      return e.isActive('orderedList');
    case 'todo':
      return e.isActive('taskList');
    case 'quote':
      return e.isActive('blockquote');
    case 'code':
      return e.isActive('codeBlock');
    default:
      return false;
  }
}

const SHORTCUTS: Array<[string, string]> = [
  ['/', 'Open the block menu (headings, lists, to-dos…)'],
  ['Ctrl+B · Ctrl+I', 'Bold · italic'],
  ['Ctrl+Shift+S · Ctrl+E', 'Strikethrough · inline code'],
  ['Ctrl+K', 'Link the selected text'],
  ['Ctrl+Alt+1 / 2 / 3', 'Heading 1 / 2 / 3 (Ctrl+Alt+0: text)'],
  ['Ctrl+Shift+8 / 7 / 9', 'Bulleted / numbered / to-do list'],
  ['Ctrl+Shift+B · Ctrl+Alt+C', 'Quote · code block'],
  ['Tab · Shift+Tab', 'Indent · outdent a list item'],
  ['# ␣  ## ␣  - ␣  1. ␣  [] ␣  > ␣  ```', 'Typing these at the start of a line works too'],
  ['[[Page name]]', 'Link to another page'],
  ['Ctrl+Z · Ctrl+Y · Ctrl+S', 'Undo · redo · save now'],
];

/**
 * Notion-style page body: what you see is the formatted page, saved as Markdown. "/" opens the block
 * menu at the cursor, Ctrl+B and friends format, a small bar on top does the same with the mouse.
 */
export function RichEditor({
  markdown,
  onChange,
  onSave,
}: {
  markdown: string;
  onChange: (md: string) => void;
  onSave: () => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<{
    query: string;
    from: number;
    to: number;
    x: number;
    y: number;
  } | null>(null);
  const [active, setActive] = useState(0);
  const [link, setLink] = useState<{ x: number; y: number; href: string } | null>(null);
  const [help, setHelp] = useState(false);
  const menuRef = useRef(menu);
  const activeRef = useRef(active);
  const linkInput = useRef<HTMLInputElement>(null);
  menuRef.current = menu;
  activeRef.current = active;
  const items = useMemo(() => (menu ? matchCommands(menu.query) : []), [menu]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  function pick(e: Editor, c: BlockCommand | undefined): void {
    const m = menuRef.current;
    if (!c || !m) return;
    e.chain().focus().deleteRange({ from: m.from, to: m.to }).run();
    c.run(e);
    setMenu(null);
  }

  function openLink(e: Editor): void {
    const { from, to } = e.state.selection;
    if (from === to && !e.isActive('link')) return;
    const at = e.view.coordsAtPos(from);
    setLink({
      x: at.left,
      y: at.bottom + 6,
      href: (e.getAttributes('link')['href'] as string | undefined) ?? '',
    });
    requestAnimationFrame(() => linkInput.current?.focus());
  }

  const editor = useEditor({
    extensions: editorExtensions("Write something, or press '/' for headings, lists, to-dos…"),
    content: markdown,
    contentType: 'markdown',
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: 'page-doc', 'aria-label': 'Page content', spellcheck: 'true' },
      handleKeyDown: (_view, event) => {
        const e = editorRef.current;
        if (!e) return false;
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.key.toLowerCase() === 's') {
          event.preventDefault();
          saveRef.current();
          return true;
        }
        if (mod && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          openLink(e);
          return true;
        }
        if (!menuRef.current) return false;
        const list = itemsRef.current;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive((i) => (list.length ? (i + step + list.length) % list.length : 0));
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          if (!list.length) return false;
          pick(e, list[activeRef.current]);
          return true;
        }
        if (event.key === 'Escape') {
          setMenu(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => changeRef.current(e.getMarkdown()),
    onSelectionUpdate: ({ editor: e }) => {
      const { $from, empty } = e.state.selection;
      if (!empty || e.isActive('codeBlock')) return setMenu(null);
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
      const q = slashQuery(before);
      // Closed once nothing matches and Sir has moved on ("/ and then a sentence").
      if (q === null || (/\s$/.test(q) && matchCommands(q).length === 0)) return setMenu(null);
      const from = $from.pos - q.length - 1;
      const at = e.view.coordsAtPos(from);
      setMenu((m) => {
        if (!m || m.query !== q) setActive(0);
        return { query: q, from, to: $from.pos, x: at.left, y: at.bottom + 6 };
      });
    },
  });
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  if (!editor) return <div className="min-h-[50vh]" />;

  return (
    <div className="relative">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="sticky top-0 z-10 -mx-2 mb-3 flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-surface-1/95 px-1 py-1 shadow-sm backdrop-blur"
      >
        {INLINE.map((b) => (
          <IconButton
            key={b.label}
            label={`${b.label} (${b.keys})`}
            active={editor.isActive(b.mark)}
            onClick={() => b.run(editor)}
          >
            <b.Icon size={16} strokeWidth={1.9} aria-hidden />
          </IconButton>
        ))}
        <IconButton
          label="Link (Ctrl+K)"
          active={editor.isActive('link')}
          onClick={() => openLink(editor)}
        >
          <Link2 size={16} strokeWidth={1.9} aria-hidden />
        </IconButton>
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        {TOOLBAR_BLOCKS.map((id) => {
          const c = BLOCK_COMMANDS.find((x) => x.id === id);
          return c ? (
            <IconButton
              key={id}
              label={c.keys ? `${c.label} (${c.keys})` : c.label}
              active={isActive(editor, id)}
              onClick={() => c.run(editor)}
            >
              <c.Icon size={16} strokeWidth={1.9} aria-hidden />
            </IconButton>
          ) : null;
        })}
        <span className="ml-auto" />
        <IconButton label="Keyboard shortcuts" active={help} onClick={() => setHelp((v) => !v)}>
          <Keyboard size={16} aria-hidden />
        </IconButton>
      </div>

      {help && (
        <div
          role="note"
          className="popover absolute top-12 right-0 z-20 max-h-[70vh] w-[28rem] overflow-y-auto p-4"
        >
          <h3 className="mb-2 text-sm font-semibold text-ink-100">Writing shortcuts</h3>
          <ul className="flex flex-col divide-y divide-line-subtle text-sm">
            {SHORTCUTS.map(([k, v]) => (
              <li key={k} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="text-ink-300">{v}</span>
                <kbd className="shrink-0 rounded-xs border border-line bg-surface-2 px-1.5 font-mono text-xs whitespace-nowrap text-ink-100">
                  {k}
                </kbd>
              </li>
            ))}
          </ul>
        </div>
      )}

      <EditorContent editor={editor} />

      {menu && (
        <div
          role="listbox"
          aria-label="Blocks"
          className="popover fixed z-50 max-h-80 w-72 overflow-y-auto p-1"
          style={{
            left: Math.min(menu.x, window.innerWidth - 300),
            top: Math.min(menu.y, window.innerHeight - 330),
          }}
          onMouseDown={(ev) => ev.preventDefault()}
        >
          <p className="px-2 pt-1 pb-1.5 text-2xs font-semibold tracking-wide text-ink-500 uppercase">
            {items.length ? 'Turn into' : 'No match'}
          </p>
          {items.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(editor, c)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left',
                i === active ? 'bg-selected' : 'hover:bg-hover',
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-sm border border-line bg-surface-1 text-ink-100">
                <c.Icon size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-100">{c.label}</span>
                <span className="block truncate text-xs text-ink-500">{c.hint}</span>
              </span>
              {c.keys && <kbd className="font-mono text-3xs text-ink-500">{c.keys}</kbd>}
            </button>
          ))}
        </div>
      )}

      {link && (
        <form
          className="popover fixed z-50 flex w-80 items-center gap-2 p-2"
          style={{ left: Math.min(link.x, window.innerWidth - 330), top: link.y }}
          onSubmit={(ev) => {
            ev.preventDefault();
            const href = link.href.trim();
            const chain = editor.chain().focus().extendMarkRange('link');
            if (href)
              chain.setLink({ href: /^[a-z]+:/i.test(href) ? href : `https://${href}` }).run();
            else chain.unsetLink().run();
            setLink(null);
          }}
        >
          <Link2 size={15} aria-hidden className="shrink-0 text-ink-500" />
          <input
            ref={linkInput}
            aria-label="Link address"
            placeholder="Paste a link, Enter"
            value={link.href}
            onChange={(ev) => setLink({ ...link, href: ev.target.value })}
            onKeyDown={(ev) => ev.key === 'Escape' && (setLink(null), editor.commands.focus())}
            onBlur={() => setLink(null)}
            className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 text-sm text-ink-100"
          />
        </form>
      )}
    </div>
  );
}
