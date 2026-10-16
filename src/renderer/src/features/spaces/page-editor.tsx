import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ExternalLink, ImageIcon, Smile, Sparkles, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call, cleanError } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';
import { useSpacesStore, type SpaceInfo } from '../../stores/spaces-store';
import { useUiStore } from '../../stores/ui-store';
import { COVERS, coverClass, readMeta, withFrontmatter } from './page-meta';
import { RichEditor } from './rich-editor';
import { SPACE_ICONS } from './space-kit';

function stripFrontmatter(md: string): { fm: string; body: string } {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
  return m ? { fm: m[0], body: md.slice(m[0].length).replace(/^\n/, '') } : { fm: '', body: md };
}

type Picker = 'icon' | 'cover' | null;

/**
 * Notion-style page: cover, icon, big title, and a formatted editor ("/" for blocks, Ctrl+B …) that
 * saves itself as Markdown. "Markdown" shows the raw text for anyone who prefers typing it.
 */
export function PageEditor({ space, page }: { space: SpaceInfo; page: string }): React.JSX.Element {
  const [title, setTitle] = useState(page);
  const [body, setBody] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ icon?: string; cover?: string }>({});
  const [picker, setPicker] = useState<Picker>(null);
  const [mode, setMode] = useState<'edit' | 'markdown'>('edit');
  /** Bumped when the stored text differs from the editor's (secrets masked on save): reload it. */
  const [version, setVersion] = useState(0);
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

  /** Saves run one after another: each must send the hash the previous one got back. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const save = useCallback(
    (text: string): Promise<void> => {
      pending.current = null;
      setStatus('saving');
      const run = async (): Promise<void> => {
        try {
          const r = await call('spaces:write', {
            space: where,
            page,
            markdown: `${fm.current}${text}`,
            ...(hash.current ? { expectedHash: hash.current } : {}),
          });
          hash.current = r.hash;
          const saved = stripFrontmatter(r.markdown).body;
          // Secrets are masked when saved (Security.md §9): show what is actually stored, unless
          // Sir kept typing meanwhile (that newer text is saved next and masked then).
          if (saved.trim() !== text.trim() && pending.current === null) {
            setBody(saved);
            setVersion((v) => v + 1);
          }
          if (pending.current === null) setStatus('saved');
        } catch (err) {
          setStatus('dirty');
          toast({ level: 'error', message: cleanError(err) });
        }
      };
      queue.current = queue.current.then(run);
      return queue.current;
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

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveNow();
    }
  }

  function saveNow(): void {
    clearTimeout(timer.current);
    const text = pending.current ?? body;
    if (text !== null) void save(text);
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
      <header
        data-titlebar
        className="flex h-12 shrink-0 items-center gap-1 border-b border-line-subtle px-3"
      >
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
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 font-code text-2xs text-ink-500" role="status">
            {status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Edited' : 'Saved'}
          </span>
          <div className="flex rounded-sm bg-surface-2 p-0.5" role="tablist" aria-label="Mode">
            {(['edit', 'markdown'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                title={m === 'edit' ? 'Formatted page' : 'Raw Markdown text'}
                onClick={() => {
                  if (m === mode) return;
                  // Each side starts from the latest text the other side wrote.
                  if (pending.current !== null) setBody(pending.current);
                  setVersion((v) => v + 1);
                  setMode(m);
                }}
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
                if (mode === 'markdown') box.current?.focus();
                else document.querySelector<HTMLElement>('.page-doc')?.focus();
              }
            }}
            className="mb-4 w-full bg-transparent font-code text-3xl font-bold text-ink-100 focus:outline-none"
          />
          {body === null ? null : mode === 'edit' ? (
            <RichEditor
              key={`${where}/${page}#${version}`}
              markdown={body}
              onChange={change}
              onSave={saveNow}
            />
          ) : (
            <textarea
              ref={box}
              aria-label="Page content as Markdown"
              value={pending.current ?? body}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKey}
              placeholder="Markdown: # heading, - list, - [ ] to-do, [[link]]"
              className="min-h-[50vh] w-full resize-none bg-transparent font-mono text-sm leading-7 text-ink-100 focus:outline-none focus-visible:outline-none"
              style={{ fieldSizing: 'content' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
