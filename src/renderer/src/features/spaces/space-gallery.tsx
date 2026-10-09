import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FileText, LayoutGrid, List, Plus, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Button, IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useMemoryStore } from '../../stores/memory-store';
import { useSpacesStore, type SpaceInfo } from '../../stores/spaces-store';
import { useUiStore } from '../../stores/ui-store';
import { coverClass } from './page-meta';
import { ago, TEMPLATES, titleFor, type Page, type Template } from './space-kit';

type Layout = 'gallery' | 'list';
const LAYOUT_KEY = 'jarvis.spaces.layout';

function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'gallery';
  } catch {
    return 'gallery';
  }
}

/** A Notion gallery card: cover with the page icon, then the title and when it changed. */
function PageCard({ page, onOpen }: { page: Page; onOpen(): void }): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="card group flex w-full flex-col overflow-hidden p-0 text-left transition duration-[120ms] hover:-translate-y-0.5 hover:border-accent-edge hover:shadow-pop"
      >
        <div
          className={clsx(
            coverClass(page.name, page.cover),
            'flex h-28 items-center justify-center',
          )}
        >
          {page.icon && (
            <span aria-hidden className="text-5xl drop-shadow-lg">
              {page.icon}
            </span>
          )}
        </div>
        <div className="flex items-start gap-2 border-t border-line px-3 py-3">
          <span aria-hidden className="mt-0.5 flex w-4 shrink-0 justify-center">
            {page.icon ?? <FileText size={15} className="text-icon-rest" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 font-semibold text-ink-100 group-hover:text-accent-300">
              {page.name}
            </span>
            <span className="mt-0.5 block font-code text-[11px] text-ink-500">
              {ago(page.updatedAt)}
            </span>
          </span>
        </div>
      </button>
    </li>
  );
}

/** One space as a Notion database page: cover banner, title, Gallery / List, search, new page. */
export function SpaceGallery({ space }: { space: SpaceInfo }): React.JSX.Element {
  const [pages, setPages] = useState<Page[]>([]);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const version = useMemoryStore((s) => s.version);
  const refreshSpaces = useSpacesStore((s) => s.refresh);
  const go = useUiStore((s) => s.go);
  const toast = useUiStore((s) => s.toast);

  const load = useCallback(async () => {
    setPages(await call('spaces:pages', { space: space.name }).catch(() => []));
  }, [space.name]);
  useEffect(() => {
    void load();
  }, [load, version]);

  function chooseLayout(next: Layout): void {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // not fatal: the choice just isn't remembered
    }
  }

  async function newPage(template: Template): Promise<void> {
    setPicking(false);
    try {
      const r = await call('spaces:createPage', {
        space: space.name,
        title: titleFor(template),
        template,
      });
      void refreshSpaces();
      go('spaces', `${space.name}/${r.name}`);
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
  const open = (p: Page): void => go('spaces', `${space.name}/${p.name}`);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={clsx(coverClass(space.name), 'h-40')}>
        <div className="absolute inset-x-0 bottom-0 h-20 bg-linear-to-b from-transparent to-main" />
      </div>
      <div className="mx-auto w-full max-w-6xl px-6 pb-16 md:px-10">
        <div className="relative z-10 -mt-10 flex items-end gap-4">
          <span
            aria-hidden
            className="relative text-6xl leading-none drop-shadow-[0_0_18px_var(--accent-glow)]"
          >
            {space.icon}
          </span>
          <div className="min-w-0 pb-1">
            <p className="hud-label">{`// space · ${String(pages.length).padStart(2, '0')} pages`}</p>
            <h1 className="truncate text-3xl font-bold text-ink-100">{space.name}</h1>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-line pb-2">
          <div role="tablist" aria-label="Layout" className="flex gap-1">
            {(
              [
                ['gallery', 'Gallery', LayoutGrid],
                ['list', 'List', List],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={layout === id}
                onClick={() => chooseLayout(id)}
                className={clsx(
                  'flex h-8 items-center gap-1.5 rounded-sm px-2.5 font-code text-xs',
                  layout === id
                    ? 'bg-selected text-ink-100 shadow-[inset_0_-2px_0_var(--accent-500)]'
                    : 'text-ink-500 hover:bg-hover hover:text-ink-100',
                )}
              >
                <Icon size={14} aria-hidden /> {label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search
              size={14}
              aria-hidden
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-icon-rest"
            />
            <TextInput
              aria-label="Search pages"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-44 pl-8 text-sm"
            />
          </div>
          <div className="relative">
            <Button variant="primary" className="h-8" onClick={() => setPicking(!picking)}>
              <FilePlus2 size={14} aria-hidden /> New page
            </Button>
            {picking && (
              <ul
                className="popover absolute right-0 z-20 mt-1 w-64 p-1"
                role="menu"
                aria-label="Page templates"
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
          <IconButton
            label="Delete space"
            className="text-ink-500"
            onClick={() => void deleteSpace()}
          >
            <Trash2 size={15} aria-hidden />
          </IconButton>
        </div>

        {query && shown.length === 0 && <p className="py-8 text-sm text-ink-500">No matches.</p>}
        {layout === 'gallery' ? (
          <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {shown.map((p) => (
              <PageCard key={p.name} page={p} onOpen={() => open(p)} />
            ))}
            <li>
              <button
                type="button"
                onClick={() => void newPage('blank')}
                className="flex h-full min-h-[11rem] w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong text-ink-500 transition-colors hover:border-accent-edge hover:bg-hover hover:text-accent-300"
              >
                <Plus size={20} aria-hidden />
                <span className="font-code text-sm">New page</span>
              </button>
            </li>
          </ul>
        ) : (
          <ul className="mt-3 divide-y divide-line-subtle">
            {shown.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  onClick={() => open(p)}
                  className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-hover"
                >
                  <span aria-hidden className="flex w-5 shrink-0 justify-center">
                    {p.icon ?? <FileText size={15} className="text-icon-rest" />}
                  </span>
                  <span className="w-1/3 min-w-0 truncate font-medium text-ink-100">{p.name}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-500">
                    {p.excerpt || 'Empty page'}
                  </span>
                  <span className="shrink-0 font-code text-[11px] text-ink-500">
                    {ago(p.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => void newPage('blank')}
                className="flex w-full items-center gap-3 px-2 py-2.5 text-left text-ink-500 hover:bg-hover hover:text-accent-300"
              >
                <Plus size={15} aria-hidden /> <span className="font-code text-sm">New page</span>
              </button>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
