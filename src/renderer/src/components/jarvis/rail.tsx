import { useEffect, useState } from 'react';
import {
  Brain,
  CalendarDays,
  ChevronRight,
  FileText,
  KeyRound,
  LayoutGrid,
  ListChecks,
  MessagesSquare,
  Network,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Puzzle,
  Settings,
  Workflow,
} from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { NewSpaceForm } from '../../features/spaces/spaces-view';
import { call } from '../../lib/api';
import { useMemoryStore } from '../../stores/memory-store';
import { useSpacesStore, type SpaceInfo } from '../../stores/spaces-store';
import { useUiStore, type View } from '../../stores/ui-store';
import { LiveOrb } from './orb';

type Page = Res<'spaces:pages'>[number];
type Item = { view: View; label: string; Icon: typeof Brain };

const WORKSPACE: Item[] = [
  { view: 'chat', label: 'Core', Icon: Orbit },
  { view: 'spaces', label: 'Spaces', Icon: LayoutGrid },
  { view: 'tasks', label: 'Tasks', Icon: ListChecks },
  { view: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { view: 'brain', label: 'Brain', Icon: Network },
  { view: 'memory', label: 'Memory', Icon: Brain },
  { view: 'passwords', label: 'Passwords', Icon: KeyRound },
];
const SYSTEMS: Item[] = [
  { view: 'automations', label: 'Automations', Icon: Workflow },
  { view: 'skills', label: 'Skills', Icon: Puzzle },
  { view: 'connections', label: 'Connections', Icon: Plug },
  { view: 'copilot', label: 'Reply copilot', Icon: MessagesSquare },
];
const SETTINGS: Item = { view: 'settings', label: 'Settings', Icon: Settings };

const rowClass = (on: boolean): string =>
  clsx(
    'flex h-9 w-full min-w-0 items-center justify-center gap-2.5 rounded-sm text-sm transition-colors duration-[120ms] lg:justify-start lg:px-2.5',
    on ? 'rail-active font-medium' : 'text-ink-300 hover:bg-hover hover:text-ink-100',
  );

/** Which parts of the Spaces tree are open; kept per PC so the sidebar looks the same next time. */
interface TreeState {
  open: boolean;
  spaces: string[];
}
const TREE_KEY = 'jarvis.rail.spaces';

function loadTree(): TreeState {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TREE_KEY) ?? 'null');
    if (v && typeof v === 'object' && 'open' in v && 'spaces' in v) {
      if (typeof v.open === 'boolean' && Array.isArray(v.spaces))
        return { open: v.open, spaces: v.spaces.filter((s): s is string => typeof s === 'string') };
    }
  } catch {
    // storage blocked or corrupt: fall back to the default below
  }
  return { open: true, spaces: [] };
}

function saveTree(t: TreeState): void {
  try {
    localStorage.setItem(TREE_KEY, JSON.stringify(t));
  } catch {
    // not fatal: the tree just won't be remembered
  }
}

function Chevron({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  label: string;
  onToggle(): void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
      className="hidden size-6 shrink-0 items-center justify-center rounded-xs text-icon-rest hover:bg-hover hover:text-ink-100 lg:flex"
    >
      <ChevronRight
        size={14}
        aria-hidden
        className={clsx('transition-transform duration-[120ms]', open && 'rotate-90')}
      />
    </button>
  );
}

/** One space in the sidebar; opened, it lists its pages like Notion's page tree. */
function SpaceNode({
  space,
  open,
  current,
  currentPage,
  onToggle,
}: {
  space: SpaceInfo;
  open: boolean;
  current: boolean;
  currentPage: string | null;
  onToggle(): void;
}): React.JSX.Element {
  const go = useUiStore((s) => s.go);
  const version = useMemoryStore((s) => s.version);
  const [pages, setPages] = useState<Page[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    call('spaces:pages', { space: space.name })
      .then((p) => alive && setPages([...p].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => alive && setPages([]));
    return () => {
      alive = false;
    };
  }, [open, space.name, space.pageCount, space.updatedAt, version]);

  return (
    <div>
      <div className="flex items-center">
        <Chevron
          open={open}
          label={`${open ? 'Hide' : 'Show'} pages in ${space.name}`}
          onToggle={onToggle}
        />
        <button
          type="button"
          title={space.name}
          aria-label={`Space: ${space.name}`}
          aria-current={current && !currentPage ? 'page' : undefined}
          onClick={() => go('spaces', space.name)}
          className={clsx(rowClass(current && !currentPage), 'h-8 lg:pl-1')}
        >
          <span aria-hidden className="w-4.5 shrink-0 text-center">
            {space.icon}
          </span>
          <span className="hidden truncate lg:inline">{space.name}</span>
          <span className="ml-auto hidden font-code text-[10px] text-ink-500 tabular lg:inline">
            {space.pageCount}
          </span>
        </button>
      </div>
      {open && (
        <ul
          aria-label={`Pages in ${space.name}`}
          className="ml-[11px] hidden flex-col gap-px border-l border-line py-0.5 pl-2 lg:flex"
        >
          {pages?.length === 0 && <li className="px-2 py-1 text-xs text-ink-500">No pages yet</li>}
          {pages?.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                title={p.name}
                aria-label={`Page: ${p.name}`}
                aria-current={current && currentPage === p.name ? 'page' : undefined}
                onClick={() => go('spaces', `${space.name}/${p.name}`)}
                className={clsx(rowClass(current && currentPage === p.name), 'h-7 text-[13px]')}
              >
                <span aria-hidden className="flex w-4 shrink-0 justify-center">
                  {p.icon ?? <FileText size={13} className="text-icon-rest" />}
                </span>
                <span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Spaces" with an accordion: the whole tree folds away, and each space folds its pages. */
function SpacesSection(): React.JSX.Element {
  const spaces = useSpacesStore((s) => s.spaces);
  const refresh = useSpacesStore((s) => s.refresh);
  const version = useMemoryStore((s) => s.version);
  const view = useUiStore((s) => s.view);
  const target = useUiStore((s) => s.spaceTarget);
  const go = useUiStore((s) => s.go);
  const [tree, setTree] = useState(loadTree);
  const [adding, setAdding] = useState(false);
  useEffect(() => void refresh(), [refresh, version]);

  const update = (next: TreeState): void => {
    setTree(next);
    saveTree(next);
  };
  const slash = target?.indexOf('/') ?? -1;
  const current =
    view === 'spaces' && target ? (slash < 0 ? target : target.slice(0, slash)) : null;
  const currentPage = current && slash >= 0 ? (target?.slice(slash + 1) ?? null) : null;

  // Opening a page from anywhere unfolds its space, so Sir always sees where he is.
  useEffect(() => {
    if (!current) return;
    setTree((t) => {
      if (t.open && t.spaces.includes(current)) return t;
      const next = { open: true, spaces: [...new Set([...t.spaces, current])] };
      saveTree(next);
      return next;
    });
  }, [current]);

  return (
    <>
      <div className="flex items-center">
        <button
          type="button"
          aria-label="Spaces"
          title="Spaces"
          aria-current={view === 'spaces' && !current ? 'page' : undefined}
          onClick={() => go('spaces')}
          className={rowClass(view === 'spaces' && !current)}
        >
          <LayoutGrid size={18} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span className="hidden truncate lg:inline">Spaces</span>
        </button>
        <Chevron
          open={tree.open}
          label={tree.open ? 'Collapse spaces' : 'Expand spaces'}
          onToggle={() => update({ ...tree, open: !tree.open })}
        />
      </div>
      {tree.open && (
        <div className="mb-1 flex flex-col gap-0.5 lg:pl-2">
          {spaces.map((sp) => (
            <SpaceNode
              key={sp.name}
              space={sp}
              open={tree.spaces.includes(sp.name)}
              current={current === sp.name}
              currentPage={current === sp.name ? currentPage : null}
              onToggle={() =>
                update({
                  ...tree,
                  spaces: tree.spaces.includes(sp.name)
                    ? tree.spaces.filter((n) => n !== sp.name)
                    : [...tree.spaces, sp.name],
                })
              }
            />
          ))}
          {adding ? (
            <div className="hidden rounded-md border border-line bg-surface-1 p-2 lg:block">
              <NewSpaceForm
                onDone={(name) => {
                  setAdding(false);
                  void refresh();
                  if (name) go('spaces', name);
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              aria-label="New space"
              title="New space"
              onClick={() => (window.innerWidth >= 1200 ? setAdding(true) : go('spaces'))}
              className={clsx(rowClass(false), 'h-8 text-ink-500 lg:pl-7')}
            >
              <Plus size={16} aria-hidden className="shrink-0" />
              <span className="hidden lg:inline">New space</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

function GroupLabel({ children }: { children: string }): React.JSX.Element {
  return (
    <p aria-hidden className="hud-label mt-3 mb-1 hidden px-2.5 lg:block">
      {`// ${children}`}
    </p>
  );
}

/** Shown in place of the sidebar while it is hidden: one button brings it back. */
function RailStub(): React.JSX.Element {
  const toggleRail = useUiStore((s) => s.toggleRail);
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-line bg-app py-2">
      <button
        type="button"
        aria-label="Show sidebar"
        title="Show sidebar (Ctrl+B)"
        onClick={toggleRail}
        className="flex size-8 items-center justify-center rounded-sm text-icon-rest hover:bg-hover hover:text-ink-100"
      >
        <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

/** §6.2: Sidebar. Icons with labels from 1200px; icons only (with tooltips) below; Ctrl+B hides it. */
export function Rail(): React.JSX.Element {
  const view = useUiStore((s) => s.view);
  const go = useUiStore((s) => s.go);
  const hidden = useUiStore((s) => s.railHidden);
  const toggleRail = useUiStore((s) => s.toggleRail);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleRail();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRail]);
  if (hidden) return <RailStub />;
  const item = ({ view: v, label, Icon }: Item): React.JSX.Element => (
    <button
      key={v}
      type="button"
      aria-label={label}
      title={label}
      aria-current={view === v ? 'page' : undefined}
      onClick={() => go(v)}
      className={rowClass(view === v)}
    >
      <Icon size={18} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span className="hidden truncate lg:inline">{label}</span>
    </button>
  );
  return (
    <nav
      aria-label="Main"
      className="flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-app px-2 py-2 lg:w-64"
    >
      <div className="mb-1 flex items-center">
        <button
          type="button"
          onClick={() => go('chat')}
          aria-label="Jarvis home"
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-sm py-1 hover:bg-hover lg:justify-start lg:px-1"
        >
          <LiveOrb size="sm" announce={false} />
          <span className="hidden flex-col items-start lg:flex" aria-hidden>
            <span
              className="glitch font-code text-sm font-semibold tracking-[0.3em] text-ink-100"
              data-text="JARVIS"
            >
              JARVIS
            </span>
            <span className="hud-label text-[9px]! text-accent-300!">neural core · online</span>
          </span>
        </button>
        <button
          type="button"
          aria-label="Hide sidebar"
          title="Hide sidebar (Ctrl+B)"
          onClick={toggleRail}
          className="hidden size-7 shrink-0 items-center justify-center rounded-sm text-icon-rest hover:bg-hover hover:text-ink-100 lg:flex"
        >
          <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <GroupLabel>workspace</GroupLabel>
      {WORKSPACE.map((i) => (
        <div key={i.view} className="contents">
          {i.view === 'spaces' ? <SpacesSection /> : item(i)}
        </div>
      ))}
      <GroupLabel>tools</GroupLabel>
      {SYSTEMS.map(item)}
      <div className="mt-auto pt-2">{item(SETTINGS)}</div>
    </nav>
  );
}
