import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  Bold,
  CheckSquare,
  Code,
  ExternalLink,
  Heading1,
  Heading2,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Smile,
  Sparkles,
  Table,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { Markdown } from '../../components/jarvis/chat-message';
import { IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call, cleanError } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';
import { useSpacesStore, type SpaceInfo } from '../../stores/spaces-store';
import { useUiStore } from '../../stores/ui-store';
import { COVERS, coverClass, readMeta, withFrontmatter } from './page-meta';
import { SPACE_ICONS } from './space-kit';

function stripFrontmatter(md: string): { fm: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? { fm: m[0], body: md.slice(m[0].length).replace(/^\n/, '') } : { fm: '', body: md };
}

const TOOLBAR: Array<{
  label: string;
  Icon: typeof Bold;
  apply: (sel: string) => { text: string; line?: boolean };
}> = [
  {
    label: 'Heading 1',
    Icon: Heading1,
    apply: (s) => ({ text: `# ${s || 'Heading'}`, line: true }),
  },
  {
    label: 'Heading 2',
    Icon: Heading2,
    apply: (s) => ({ text: `## ${s || 'Heading'}`, line: true }),
  },
  { label: 'Bold', Icon: Bold, apply: (s) => ({ text: `**${s || 'bold'}**` }) },
  { label: 'Italic', Icon: Italic, apply: (s) => ({ text: `*${s || 'italic'}*` }) },
  { label: 'Bulleted list', Icon: List, apply: (s) => ({ text: `- ${s}`, line: true }) },
  { label: 'Numbered list', Icon: ListOrdered, apply: (s) => ({ text: `1. ${s}`, line: true }) },
  { label: 'To-do', Icon: CheckSquare, apply: (s) => ({ text: `- [ ] ${s}`, line: true }) },
  { label: 'Quote', Icon: Quote, apply: (s) => ({ text: `> ${s}`, line: true }) },
  { label: 'Code block', Icon: Code, apply: (s) => ({ text: `\`\`\`\n${s}\n\`\`\``, line: true }) },
  {
    label: 'Table',
    Icon: Table,
    apply: () => ({ text: '| Column | Column |\n|---|---|\n|  |  |', line: true }),
  },
  {
    label: 'Link to another note',
    Icon: Link2,
    apply: (s) => ({ text: `[[${s || 'Note name'}]]` }),
  },
  { label: 'Divider', Icon: Minus, apply: () => ({ text: '---', line: true }) },
];

type Picker = 'icon' | 'cover' | null;

/** Notion-style page: cover, icon, big title, a formatting bar, write / preview, saves itself. */
export function PageEditor({ space, page }: { space: SpaceInfo; page: string }): React.JSX.Element {
  const [title, setTitle] = useState(page);
  const [body, setBody] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ icon?: string; cover?: string }>({});
  const [picker, setPicker] = useState<Picker>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const fm = useRef('');
  const hash = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const box = useRef<HTMLTextAreaElement>(null);
  /** Text typed but not yet saved (saved on unmount too, so switching pages never loses words). */
  const pending = useRef<string | null>(null);
  const toast = useUiStore((s) => s.toast);
  const go = useUiStore((s) => s.go);
  const refreshSpaces = useSpacesStore((s) => s.refresh);
  const where = space.name;

  useEffect(() => {
    setTitle(page);
    setBody(null);
    void call('spaces:read', { space: where, page })
      .then((r) => {
        const { fm: f, body: b } = stripFrontmatter(r.markdown);
        fm.current = f;
        hash.current = r.hash;
        setMeta(readMeta(f));
        setBody(b);
        setStatus('saved');
      })
      .catch((err: unknown) => toast({ level: 'error', message: cleanError(err) }));
  }, [where, page, toast]);

  const save = useCallback(
    async (text: string) => {
      pending.current = null;
      setStatus('saving');
      try {
        const r = await call('spaces:write', {
          space: where,
          page,
          markdown: `${fm.current}${text}`,
          ...(hash.current ? { expectedHash: hash.current } : {}),
        });
        hash.current = r.hash;
        const saved = stripFrontmatter(r.markdown).body;
        // Secrets are masked when saved (Security.md §9): show what is actually stored.
        if (saved.trim() !== text.trim()) setBody(saved);
        setStatus('saved');
      } catch (err) {
        setStatus('dirty');
        toast({ level: 'error', message: cleanError(err) });
      }
    },
    [where, page, toast],
  );

  function change(text: string): void {
    setBody(text);
    setStatus('dirty');
    pending.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(text), 900);
  }

  // Save before switching pages or leaving the view.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null) void saveRef.current(pending.current);
    },
    [],
  );

  /** Icon and cover live in the page's frontmatter, so Obsidian keeps them too. */
  function setPageMeta(key: 'icon' | 'cover', value?: string): void {
    setPicker(null);
    if (body === null) return;
    fm.current = withFrontmatter(fm.current, key, value);
    setMeta(readMeta(fm.current));
    clearTimeout(timer.current);
    void save(pending.current ?? body);
  }

  function insert(apply: (typeof TOOLBAR)[number]['apply']): void {
    const el = box.current;
    if (!el || body === null) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const r = apply(body.slice(a, b));
    const before = body.slice(0, a);
    const prefix = r.line && before && !before.endsWith('\n') ? '\n' : '';
    const next = `${before}${prefix}${r.text}${body.slice(b)}`;
    change(next);
    requestAnimationFrame(() => {
      el.focus();
      const at = a + prefix.length + r.text.length;
      el.setSelectionRange(at, at);
    });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      clearTimeout(timer.current);
      if (body !== null) void save(body);
    }
    // Enter on a list line continues the list, like Notion.
    if (e.key === 'Enter' && !e.shiftKey && body !== null) {
      const el = e.currentTarget;
      const lineStart = body.lastIndexOf('\n', el.selectionStart - 1) + 1;
      const line = body.slice(lineStart, el.selectionStart);
      const m = /^(\s*)(- \[[ x]\] |- |\* |(\d+)\. )/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[2]?.trim()) {
        change(body.slice(0, lineStart) + body.slice(el.selectionStart));
        return;
      }
      const bullet = m[3] ? `${Number(m[3]) + 1}. ` : (m[2] ?? '').replace('[x]', '[ ]');
      const ins = `\n${m[1] ?? ''}${bullet}`;
      const at = el.selectionStart;
      change(body.slice(0, at) + ins + body.slice(el.selectionEnd));
      requestAnimationFrame(() => el.setSelectionRange(at + ins.length, at + ins.length));
    }
  }

  async function rename(): Promise<void> {
    const next = title.trim();
    if (!next || next === page) return setTitle(page);
    try {
      clearTimeout(timer.current);
      if (body !== null && status !== 'saved') await save(body);
      await call('spaces:renamePage', { space: where, page, next });
      go('spaces', `${where}/${next}`);
    } catch (err) {
      setTitle(page);
      toast({ level: 'error', message: cleanError(err) });
    }
  }

  async function remove(): Promise<void> {
    const yes = await confirmAction({
      title: `Delete "${page}"?`,
      body: "The page moves to the vault's .trash folder; you can restore it from Obsidian.",
      actionLabel: 'Delete',
      destructive: true,
    });
    if (!yes) return;
    clearTimeout(timer.current);
    pending.current = null;
    await call('spaces:deletePage', { space: where, page }).catch((err: unknown) =>
      toast({ level: 'error', message: cleanError(err) }),
    );
    void refreshSpaces();
    go('spaces', where);
  }

  function askJarvis(): void {
    useChatStore.getState().newConversation();
    useChatStore.setState({ draft: `Using my "${where} / ${page}" page in Spaces, ` });
    go('chat');
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line-subtle px-3">
        <IconButton label={`Back to ${where}`} onClick={() => go('spaces', where)}>
          <ArrowLeft size={16} aria-hidden />
        </IconButton>
        <nav aria-label="Breadcrumb" className="mr-2 hidden min-w-0 items-center gap-1.5 md:flex">
          <button
            type="button"
            onClick={() => go('spaces', where)}
            className="truncate font-code text-xs text-ink-500 hover:text-accent-300"
          >
            {space.icon} {where}
          </button>
          <span aria-hidden className="text-ink-500">
            /
          </span>
          <span className="max-w-48 truncate font-code text-xs text-ink-100">{page}</span>
        </nav>
        <div
          className="flex items-center gap-0.5 overflow-x-auto border-l border-line-subtle pl-1"
          role="toolbar"
          aria-label="Formatting"
        >
          {TOOLBAR.map((t) => (
            <IconButton
              key={t.label}
              label={t.label}
              disabled={mode !== 'write'}
              onClick={() => insert(t.apply)}
            >
              <t.Icon size={16} strokeWidth={1.75} aria-hidden />
            </IconButton>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 font-code text-[11px] text-ink-500" role="status">
            {status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Edited' : 'Saved'}
          </span>
          <div className="flex rounded-sm bg-surface-2 p-0.5" role="tablist" aria-label="Mode">
            {(['write', 'preview'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={clsx(
                  'rounded-xs px-2.5 py-1 font-code text-xs capitalize',
                  mode === m ? 'bg-surface-1 text-ink-100 shadow-sm' : 'text-ink-500',
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <IconButton label="Ask Jarvis about this page" onClick={askJarvis}>
            <Sparkles size={16} aria-hidden />
          </IconButton>
          <IconButton
            label="Open in Obsidian"
            onClick={() =>
              void call('memory:openInObsidian', { vaultPath: `Spaces/${where}/${page}.md` })
            }
          >
            <ExternalLink size={16} aria-hidden />
          </IconButton>
          <IconButton label="Delete page" className="text-alarm-500" onClick={() => void remove()}>
            <Trash2 size={16} aria-hidden />
          </IconButton>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={clsx(coverClass(page, meta.cover), 'group/cover h-36')}>
          <button
            type="button"
            onClick={() => setPicker(picker === 'cover' ? null : 'cover')}
            className="absolute right-4 bottom-3 flex items-center gap-1.5 rounded-sm border border-line-strong bg-surface-1 px-2 py-1 font-code text-xs text-ink-100 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-visible:opacity-100"
          >
            <ImageIcon size={13} aria-hidden /> Change cover
          </button>
        </div>
        {picker === 'cover' && (
          <div
            role="menu"
            aria-label="Covers"
            className="popover relative z-10 mx-auto -mt-2 grid w-full max-w-3xl grid-cols-4 gap-2 p-3"
          >
            {COVERS.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={meta.cover === c}
                aria-label={`Cover: ${c}`}
                onClick={() => setPageMeta('cover', c)}
                className={clsx(
                  coverClass('', c),
                  'h-14 rounded-sm',
                  meta.cover === c && 'ring-2 ring-accent-500',
                )}
              />
            ))}
          </div>
        )}
        <div className="mx-auto w-full max-w-3xl px-6 pb-24 md:px-10">
          <div className="relative -mt-9 mb-2 flex items-end gap-2">
            <button
              type="button"
              aria-label={meta.icon ? `Page icon ${meta.icon}` : 'Add an icon'}
              onClick={() => setPicker(picker === 'icon' ? null : 'icon')}
              className="flex size-16 items-center justify-center rounded-md border border-line bg-surface-1 text-4xl shadow-pop hover:border-accent-edge"
            >
              {meta.icon ?? <Smile size={24} aria-hidden className="text-icon-rest" />}
            </button>
            {picker === 'icon' && (
              <div
                role="menu"
                aria-label="Icons"
                className="popover absolute top-full left-0 z-20 mt-2 grid w-72 grid-cols-8 gap-1 p-2"
              >
                {SPACE_ICONS.map((i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    aria-label={`Icon ${i}`}
                    onClick={() => setPageMeta('icon', i)}
                    className="flex size-8 items-center justify-center rounded-sm text-lg hover:bg-hover"
                  >
                    {i}
                  </button>
                ))}
                {meta.icon && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setPageMeta('icon', undefined)}
                    className="col-span-8 mt-1 rounded-sm py-1 font-code text-xs text-ink-500 hover:bg-hover hover:text-ink-100"
                  >
                    Remove icon
                  </button>
                )}
              </div>
            )}
          </div>
          <input
            aria-label="Page title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                box.current?.focus();
              }
            }}
            className="mb-4 w-full bg-transparent font-code text-3xl font-bold text-ink-100 focus:outline-none"
          />
          {body === null ? null : mode === 'write' ? (
            <textarea
              ref={box}
              aria-label="Page content"
              value={body}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKey}
              placeholder="Start writing… Markdown works: # heading, - list, - [ ] to-do, [[link]]"
              className="min-h-[50vh] w-full resize-none bg-transparent text-base leading-7 text-ink-100 focus:outline-none focus-visible:outline-none"
              style={{ fieldSizing: 'content' }}
            />
          ) : (
            <div className="min-h-[50vh]">
              <Markdown text={body || '_Empty page_'} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
