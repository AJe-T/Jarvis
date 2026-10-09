import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useMemoryStore } from '../../stores/memory-store';
import { useSpacesStore, type SpaceInfo } from '../../stores/spaces-store';
import { useUiStore } from '../../stores/ui-store';
import { coverClass } from './page-meta';
import { PageEditor } from './page-editor';
import { SpaceGallery } from './space-gallery';
import { ago, SPACE_ICONS, type Page } from './space-kit';

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

/** Spaces home: every space as a gallery card plus the most recently edited pages. */
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
      <div className="mx-auto w-full max-w-6xl px-6 py-10 md:px-10">
        <p className="hud-label">{`// spaces · ${String(spaces.length).padStart(2, '0')} online`}</p>
        <h1 className="mt-1 text-3xl font-bold text-ink-100">Spaces</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-500">
          Your own notebooks for anything — learning, money, ideas. Pages are Markdown files in your
          Obsidian vault, so Jarvis can look things up in them when you ask.
        </p>
        <ul className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {spaces.map((sp) => (
            <li key={sp.name}>
              <button
                type="button"
                onClick={() => go('spaces', sp.name)}
                className="card group flex w-full flex-col overflow-hidden p-0 text-left transition duration-[120ms] hover:-translate-y-0.5 hover:border-accent-edge hover:shadow-pop"
              >
                <div className={clsx(coverClass(sp.name), 'flex h-28 items-center justify-center')}>
                  <span aria-hidden className="text-5xl drop-shadow-lg">
                    {sp.icon}
                  </span>
                </div>
                <div className="border-t border-line px-3 py-3">
                  <span className="block font-semibold text-ink-100 group-hover:text-accent-300">
                    {sp.name}
                  </span>
                  <span className="font-code text-[11px] text-ink-500">
                    {sp.pageCount} {sp.pageCount === 1 ? 'page' : 'pages'} · {ago(sp.updatedAt)}
                  </span>
                </div>
              </button>
            </li>
          ))}
          <li className="min-h-[11rem] rounded-md border border-dashed border-line-strong p-4">
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
                className="flex h-full w-full flex-col items-center justify-center gap-2 font-code text-sm text-ink-500 hover:text-accent-300"
              >
                <Plus size={20} aria-hidden />
                New space
              </button>
            )}
          </li>
        </ul>
        {recent.length > 0 && (
          <>
            <h2 className="hud-label mt-12 mb-3">{'// recently edited'}</h2>
            <ul className="divide-y divide-line-subtle rounded-md border border-line bg-surface-1">
              {recent.map((p) => (
                <li key={`${p.space.name}/${p.name}`}>
                  <button
                    type="button"
                    onClick={() => go('spaces', `${p.space.name}/${p.name}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                  >
                    <span aria-hidden className="flex w-5 justify-center">
                      {p.icon ?? <FileText size={15} className="text-icon-rest" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink-100">{p.name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {p.excerpt || 'Empty page'}
                      </span>
                    </span>
                    <span className="shrink-0 font-code text-[11px] text-ink-500">
                      {p.space.icon} {p.space.name} · {ago(p.updatedAt)}
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

/** PRD F18: Notion-style Spaces. The target ("Space" or "Space/Page") picks the screen. */
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
  if (pageName)
    return <PageEditor key={`${space.name}/${pageName}`} space={space} page={pageName} />;
  return <SpaceGallery space={space} />;
}
