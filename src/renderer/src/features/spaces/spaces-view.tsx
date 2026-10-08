import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  Bold,
  CheckSquare,
  Code,
  ExternalLink,
  FilePlus2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Search,
  Sparkles,
  Table,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import type { Req, Res } from '@shared/ipc-contract';
import { Markdown } from '../../components/jarvis/chat-message';
import { Button, IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';
import { useMemoryStore } from '../../stores/memory-store';
import { useSpacesStore, type SpaceInfo } from '../../stores/spaces-store';
import { useUiStore } from '../../stores/ui-store';

type Page = Res<'spaces:pages'>[number];
type Template = Req<'spaces:createPage'>['template'];

export const SPACE_ICONS = [
  '📚',
  '💰',
  '💡',
  '🧠',
  '🏋️',
  '🍳',
  '✈️',
  '🎯',
  '🛠️',
  '🎵',
  '📈',
  '🧾',
  '❤️',
  '🌱',
  '🏠',
  '💼',
  '🎓',
  '📝',
  '🧪',
  '🎮',
  '📷',
  '🗂️',
  '⭐',
  '📁',
];
const TEMPLATES: Array<{ id: Template; label: string; hint: string }> = [
  { id: 'blank', label: 'Blank page', hint: 'Start from nothing' },
  { id: 'learning', label: 'Learning note', hint: 'Key ideas, questions, next steps' },
  { id: 'journal', label: 'Journal entry', hint: 'How I feel, what happened' },
  { id: 'meeting', label: 'Meeting notes', hint: 'Agenda, decisions, actions' },
  { id: 'finance', label: 'Expense log', hint: 'A table of spending' },
  { id: 'project', label: 'Project plan', hint: 'Goal, milestones, resources' },
];

const ago = (iso: string | null): string => {
  if (!iso) return 'empty';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

function stripFrontmatter(md: string): { fm: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? { fm: m[0], body: md.slice(m[0].length).replace(/^\n/, '') } : { fm: '', body: md };
}

/** "New space" form: a name and an icon. */
export function NewSpaceForm({ onDone }: { onDone(name: string | null): void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📚');
  const toast = useUiStore((s) => s.toast);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void call('spaces:create', { name: name.trim(), icon })
          .then(() => onDone(name.trim()))
          .catch((err: unknown) => toast({ level: 'error', message: cleanError(err) }));
      }}
    >
      <TextInput
        autoFocus
        aria-label="Space name"
        placeholder="e.g. Learning, Finance, Fitness"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Icon">
        {SPACE_ICONS.map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={icon === i}
            aria-label={`Icon ${i}`}
            onClick={() => setIcon(i)}
            className={clsx(
              'flex size-8 items-center justify-center rounded-sm text-lg',
              icon === i ? 'bg-selected ring-1 ring-accent-edge' : 'hover:bg-hover',
            )}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={!name.trim()}>
          Create space
        </Button>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Spaces home: every space as a card plus the most recently edited pages. */
function Dashboard(): React.JSX.Element {
  const spaces = useSpacesStore((s) => s.spaces);
  const refresh = useSpacesStore((s) => s.refresh);
  const go = useUiStore((s) => s.go);
  const [adding, setAdding] = useState(false);
  const [recent, setRecent] = useState<Array<Page & { space: SpaceInfo }>>([]);
  const version = useMemoryStore((s) => s.version);

  useEffect(() => {
    void Promise.all(
      spaces.map(async (sp) =>
        (await call('spaces:pages', { space: sp.name }).catch(() => [])).map((p) => ({
          ...p,
          space: sp,
        })),
      ),
    ).then((all) =>
      setRecent(
        all
          .flat()
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 8),
      ),
    );
  }, [spaces, version]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
        <h1 className="text-2xl font-semibold text-ink-100">Spaces</h1>
        <p className="mt-1 max-w-xl text-sm text-ink-500">
          Your own notebooks for anything — learning, money, ideas. Pages are Markdown files in your
          Obsidian vault, so Jarvis can look things up in them when you ask.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((sp) => (
            <button
              key={sp.name}
              type="button"
              onClick={() => go('spaces', sp.name)}
              className="group flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4 text-left shadow-sm transition hover:-translate-y-px hover:border-line-strong hover:shadow-md"
            >
              <span className="text-3xl leading-none">{sp.icon}</span>
              <span>
                <span className="block font-semibold text-ink-100">{sp.name}</span>
                <span className="text-xs text-ink-500">
                  {sp.pageCount} {sp.pageCount === 1 ? 'page' : 'pages'} · {ago(sp.updatedAt)}
                </span>
              </span>
            </button>
          ))}
          <div className="rounded-lg border border-dashed border-line-strong p-4">
            {adding ? (
              <NewSpaceForm
                onDone={(name) => {
                  setAdding(false);
                  void refresh();
                  if (name) go('spaces', name);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-2 text-ink-500 hover:text-ink-100"
              >
                <Plus size={20} aria-hidden />
                New space
              </button>
            )}
          </div>
        </div>
        {recent.length > 0 && (
          <>
            <h2 className="mt-10 mb-3 text-sm font-semibold tracking-wide text-ink-500 uppercase">
              Recently edited
            </h2>
            <ul className="divide-y divide-line-subtle rounded-lg border border-line">
              {recent.map((p) => (
                <li key={`${p.space.name}/${p.name}`}>
                  <button
                    type="button"
                    onClick={() => go('spaces', `${p.space.name}/${p.name}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                  >
                    <span aria-hidden>{p.space.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-100">{p.name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {p.excerpt || 'Empty page'}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-500">
                      {p.space.name} · {ago(p.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
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

/** Notion-style page: big title, a formatting bar, write / preview, saves itself. */
function PageEditor({
  space,
  page,
  onRenamed,
  onDeleted,
}: {
  space: string;
  page: string;
  onRenamed(name: string): void;
  onDeleted(): void;
}): React.JSX.Element {
  const [title, setTitle] = useState(page);
  const [body, setBody] = useState<string | null>(null);
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

  useEffect(() => {
    setTitle(page);
    setBody(null);
    void call('spaces:read', { space, page })
      .then((r) => {
        const { fm: f, body: b } = stripFrontmatter(r.markdown);
        fm.current = f;
        hash.current = r.hash;
        setBody(b);
        setStatus('saved');
      })
      .catch((err: unknown) => toast({ level: 'error', message: cleanError(err) }));
  }, [space, page, toast]);

  const save = useCallback(
    async (text: string) => {
      pending.current = null;
      setStatus('saving');
      try {
        const r = await call('spaces:write', {
          space,
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
    [space, page, toast],
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
      await call('spaces:renamePage', { space, page, next });
      onRenamed(next);
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
    await call('spaces:deletePage', { space, page }).catch((err: unknown) =>
      toast({ level: 'error', message: cleanError(err) }),
    );
    onDeleted();
  }

  function askJarvis(): void {
    useChatStore.getState().newConversation();
    useChatStore.setState({ draft: `Using my "${space} / ${page}" page in Spaces, ` });
    go('chat');
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line-subtle px-3">
        <div
          className="flex items-center gap-0.5 overflow-x-auto"
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
          <span className="mr-2 text-xs text-ink-500" role="status">
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
                  'rounded-xs px-2.5 py-1 text-xs capitalize',
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
              void call('memory:openInObsidian', { vaultPath: `Spaces/${space}/${page}.md` })
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
        <div className="mx-auto w-full max-w-3xl px-6 py-8 md:px-10">
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
            className="mb-4 w-full bg-transparent text-3xl font-bold text-ink-100 focus:outline-none"
          />
          {body === null ? null : mode === 'write' ? (
            <textarea
              ref={box}
              aria-label="Page content"
              value={body}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKey}
              placeholder="Start writing… Markdown works: # heading, - list, - [ ] to-do, [[link]]"
              className="min-h-[60vh] w-full resize-none bg-transparent text-base leading-7 text-ink-100 focus:outline-none focus-visible:outline-none"
              style={{ fieldSizing: 'content' }}
            />
          ) : (
            <div className="min-h-[60vh]">
              <Markdown text={body || '_Empty page_'} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One space: its pages on the left, the open page on the right. */
function SpaceView({
  space,
  initialPage,
}: {
  space: SpaceInfo;
  initialPage: string | null;
}): React.JSX.Element {
  const [pages, setPages] = useState<Page[]>([]);
  const [open, setOpen] = useState<string | null>(initialPage);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const version = useMemoryStore((s) => s.version);
  const refreshSpaces = useSpacesStore((s) => s.refresh);
  const go = useUiStore((s) => s.go);
  const toast = useUiStore((s) => s.toast);

  const load = useCallback(async () => {
    const p = await call('spaces:pages', { space: space.name }).catch(() => []);
    setPages(p);
    setOpen((cur) => cur ?? p[0]?.name ?? null);
  }, [space.name]);

  useEffect(() => {
    void load();
  }, [load, version]);
  useEffect(() => setOpen(initialPage), [initialPage, space.name]);

  async function newPage(template: Template): Promise<void> {
    setPicking(false);
    const label = TEMPLATES.find((t) => t.id === template)?.label ?? 'Untitled';
    const title =
      template === 'journal'
        ? new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : template === 'blank'
          ? 'Untitled'
          : label;
    try {
      const r = await call('spaces:createPage', { space: space.name, title, template });
      await load();
      setOpen(r.name);
      void refreshSpaces();
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    }
  }

  async function deleteSpace(): Promise<void> {
    const yes = await confirmAction({
      title: `Delete the "${space.name}" space?`,
      body: `All ${pages.length} pages move to the vault's .trash folder (restorable from Obsidian).`,
      actionLabel: 'Delete space',
      destructive: true,
    });
    if (!yes) return;
    await call('spaces:delete', { name: space.name }).catch((err: unknown) =>
      toast({ level: 'error', message: cleanError(err) }),
    );
    await refreshSpaces();
    go('spaces');
  }

  const shown = pages.filter(
    (p) => !query || `${p.name} ${p.excerpt}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label={`${space.name} pages`}
        className="flex w-56 shrink-0 flex-col border-r border-line-subtle md:w-64"
      >
        <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line-subtle pr-1 pl-2">
          <IconButton label="All spaces" onClick={() => go('spaces')}>
            <ArrowLeft size={16} aria-hidden />
          </IconButton>
          <span aria-hidden>{space.icon}</span>
          <h1 className="truncate text-ui font-semibold text-ink-100">{space.name}</h1>
          <IconButton
            label="Delete space"
            className="ml-auto text-ink-500"
            onClick={() => void deleteSpace()}
          >
            <Trash2 size={14} aria-hidden />
          </IconButton>
        </div>
        <div className="relative px-3 pt-3">
          <Search size={14} aria-hidden className="absolute top-[23px] left-5.5 text-icon-rest" />
          <TextInput
            aria-label="Search pages"
            placeholder="Search pages"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-7 text-sm"
          />
        </div>
        <div className="relative px-3 py-2">
          <Button className="w-full justify-start" onClick={() => setPicking(!picking)}>
            <FilePlus2 size={14} aria-hidden /> New page
          </Button>
          {picking && (
            <ul
              className="absolute right-3 left-3 z-10 mt-1 rounded-md border border-line bg-surface-1 p-1 shadow-pop"
              role="menu"
            >
              {TEMPLATES.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void newPage(t.id)}
                    className="w-full rounded-sm px-2.5 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="block text-sm text-ink-100">{t.label}</span>
                    <span className="block text-xs text-ink-500">{t.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ul className="flex-1 overflow-y-auto px-2 pb-3">
          {shown.length === 0 && (
            <li className="px-3 py-4 text-sm text-ink-500">
              {pages.length ? 'No matches.' : 'No pages yet.'}
            </li>
          )}
          {shown.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                aria-current={open === p.name ? 'true' : undefined}
                onClick={() => setOpen(p.name)}
                className={clsx(
                  'w-full rounded-sm px-2.5 py-2 text-left transition-colors',
                  open === p.name ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <span className="block truncate text-sm text-ink-100">{p.name}</span>
                <span className="block truncate text-xs text-ink-500">{ago(p.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {open ? (
        <PageEditor
          key={`${space.name}/${open}`}
          space={space.name}
          page={open}
          onRenamed={(n) => {
            setOpen(n);
            void load();
          }}
          onDeleted={() => {
            setOpen(null);
            void load();
            void refreshSpaces();
          }}
        />
      ) : (
        <div className="m-auto flex flex-col items-center gap-3 p-6 text-center text-ink-500">
          <span className="text-4xl">{space.icon}</span>
          <p>Create the first page in {space.name}.</p>
          <Button variant="primary" onClick={() => void newPage('blank')}>
            New page
          </Button>
        </div>
      )}
    </div>
  );
}

/** PRD F18: Notion-style Spaces. */
export function SpacesView(): React.JSX.Element {
  const target = useUiStore((s) => s.spaceTarget);
  const spaces = useSpacesStore((s) => s.spaces);
  const refresh = useSpacesStore((s) => s.refresh);
  const version = useMemoryStore((s) => s.version);
  useEffect(() => void refresh(), [refresh, version]);

  const [spaceName, pageName] = useMemo(() => {
    if (!target) return [null, null];
    const i = target.indexOf('/');
    return i < 0 ? [target, null] : [target.slice(0, i), target.slice(i + 1)];
  }, [target]);
  const space = spaces.find((s) => s.name === spaceName);
  if (!space) return <Dashboard />;
  return <SpaceView space={space} initialPage={pageName} />;
}
