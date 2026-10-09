import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Atom,
  ChevronDown,
  ExternalLink,
  GitBranch,
  LayoutDashboard,
  Maximize2,
  Network,
  NotebookPen,
  RefreshCw,
  Search,
  Shapes,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Markdown } from '../../components/jarvis/chat-message';
import { Button, IconButton } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { useMemoryStore } from '../../stores/memory-store';
import { useUiStore } from '../../stores/ui-store';
import { colorOf, degrees, type BrainViewProps } from './brain-layout';
import { ClusterView } from './views/cluster-view';
import { MindmapView } from './views/mindmap-view';
import { NeuralView } from './views/neural-view';
import { Orb3DView } from './views/orb3d-view';
import { TreemapView } from './views/treemap-view';

type Graph = Res<'memory:graph'>;
type ViewId = 'neural' | 'orbs' | 'clusters' | 'stars' | 'mindmap' | 'treemap';

const VIEWS: Array<{
  id: ViewId;
  label: string;
  Icon: LucideIcon;
  hint: string;
  Component: (p: BrainViewProps) => React.JSX.Element;
}> = [
  {
    id: 'neural',
    label: 'Neural',
    Icon: Network,
    hint: 'Living network: drag dots, signals flow along links',
    Component: NeuralView,
  },
  {
    id: 'orbs',
    label: '3D orbs',
    Icon: Atom,
    hint: 'A galaxy of glass orbs: drag to spin, scroll to fly in',
    Component: Orb3DView,
  },
  {
    id: 'clusters',
    label: 'Clusters',
    Icon: Shapes,
    hint: 'Each folder a soft island with its links',
    Component: (p) => <ClusterView {...p} variant="hulls" />,
  },
  {
    id: 'stars',
    label: 'Constellations',
    Icon: Waypoints,
    hint: 'Each folder a star with its notes around it',
    Component: (p) => <ClusterView {...p} variant="stars" />,
  },
  {
    id: 'mindmap',
    label: 'Mind map',
    Icon: GitBranch,
    hint: 'Folders as branches: click a dot to fold or open',
    Component: MindmapView,
  },
  {
    id: 'treemap',
    label: 'Treemap',
    Icon: LayoutDashboard,
    hint: 'Boxes sized by notes: click a folder to step in',
    Component: TreemapView,
  },
];
const VIEW_KEY = 'jarvis.brain.view';

function loadView(): ViewId {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEWS.some((x) => x.id === v) ? (v as ViewId) : 'neural';
  } catch {
    return 'neural';
  }
}

function stripFm(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** PRD F19: the Brain — the vault as a graph, seen six ways. */
export function BrainView(): React.JSX.Element {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [viewId, setViewId] = useState<ViewId>(loadView);
  const [showFolders, setShowFolders] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ id: string; serial: number } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const version = useMemoryStore((s) => s.version);
  const reduced = useReducedMotion();
  const go = useUiStore((s) => s.go);

  const load = useCallback(() => {
    void call('memory:graph', {})
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], links: [] }));
  }, []);
  useEffect(load, [load, version]);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, viewId);
    } catch {
      // not remembered; fine
    }
  }, [viewId]);

  const nodes = useMemo(
    () => (graph?.nodes ?? []).filter((n) => showFolders || n.group !== 'folder'),
    [graph, showFolders],
  );
  const links = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return (graph?.links ?? []).filter((l) => ids.has(l.source) && ids.has(l.target));
  }, [graph, nodes]);
  const deg = useMemo(() => degrees(graph?.links ?? []), [graph]);
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graph?.nodes ?? [])
      if (n.group !== 'folder') counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);
  const selected = selectedId ? (graph?.nodes.find((n) => n.id === selectedId) ?? null) : null;

  function select(id: string | null): void {
    setSelectedId(id);
    setNote(null);
    const n = id ? graph?.nodes.find((x) => x.id === id) : null;
    if (n && n.group !== 'folder')
      void call('memory:read', { vaultPath: n.id })
        .then((r) => setNote(stripFm(r.markdown)))
        .catch(() => setNote('_This note could not be opened._'));
  }

  function search(): void {
    const q = query.trim().toLowerCase();
    if (!q || !graph) return;
    const n =
      graph.nodes.find((x) => x.title.toLowerCase() === q) ??
      graph.nodes.find((x) => x.title.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
    if (n) {
      setFocus((f) => ({ id: n.id, serial: (f?.serial ?? 0) + 1 }));
      select(n.id);
    }
  }

  const active = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0];
  const View = active?.Component ?? NeuralView;
  const spacePath = selected && /^Spaces\/([^/]+)\/(.+)\.md$/.exec(selected.id);
  const noteCount = graph?.nodes.filter((n) => n.group !== 'folder').length ?? 0;

  return (
    <div className="flex min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#03060d]">
          {graph && graph.nodes.length > 0 && (
            <View
              key={viewId}
              nodes={nodes}
              links={links}
              hidden={hidden}
              selectedId={selectedId}
              focus={focus}
              fitSignal={fitSignal}
              reduced={reduced}
              onSelect={select}
            />
          )}

          {/* View switcher */}
          <div
            role="tablist"
            aria-label="Brain view"
            className="absolute top-3 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-pill border border-white/10 bg-black/60 p-1 shadow-pop backdrop-blur"
          >
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={v.id === viewId}
                aria-label={v.label}
                title={v.hint}
                onClick={() => setViewId(v.id)}
                className={clsx(
                  'flex h-8 items-center gap-1.5 rounded-pill px-3 text-xs font-medium transition-colors',
                  v.id === viewId
                    ? 'bg-white/15 text-white shadow-[0_0_12px_var(--accent-glow)]'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                )}
              >
                <v.Icon size={14} aria-hidden />
                <span className="hidden xl:inline">{v.label}</span>
              </button>
            ))}
          </div>

          {/* Search + legend */}
          <div className="absolute top-3 left-3 flex max-w-64 flex-col gap-2">
            <form
              role="search"
              className="flex items-center gap-1 rounded-md bg-black/50 p-1 backdrop-blur"
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <Search size={14} aria-hidden className="ml-1.5 text-slate-300" />
              <TextInput
                aria-label="Find a note"
                placeholder="Find a note"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 min-h-8 w-44 border-transparent bg-transparent text-sm text-white placeholder:text-slate-400"
              />
            </form>
            <div className="rounded-md bg-black/50 text-xs text-slate-200 backdrop-blur">
              <button
                type="button"
                aria-expanded={legendOpen}
                onClick={() => setLegendOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-2 py-1.5 font-semibold text-white"
              >
                {noteCount} notes · {graph?.links.filter((l) => l.kind === 'link').length ?? 0}{' '}
                links
                <ChevronDown
                  size={13}
                  aria-hidden
                  className={clsx('ml-auto transition-transform', legendOpen && 'rotate-180')}
                />
              </button>
              {legendOpen && (
                <div className="max-h-[50vh] overflow-y-auto px-2 pb-2">
                  {groups.map(([g, count]) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={!hidden.has(g)}
                      onClick={() =>
                        setHidden((h) => {
                          const next = new Set(h);
                          if (next.has(g)) next.delete(g);
                          else next.add(g);
                          return next;
                        })
                      }
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-xs px-1 py-0.5 text-left hover:bg-white/10',
                        hidden.has(g) && 'opacity-40',
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-pill"
                        style={{ background: colorOf(g) }}
                      />
                      <span className="truncate">{g}</span>
                      <span className="ml-auto text-slate-400">{count}</span>
                    </button>
                  ))}
                  <label className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                    <input
                      type="checkbox"
                      checked={showFolders}
                      onChange={(e) => setShowFolders(e.target.checked)}
                    />
                    Show folder hubs
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="absolute top-3 right-3 flex gap-1 rounded-md bg-black/50 p-1 text-white backdrop-blur">
            <IconButton
              label="Fit to screen"
              className="text-slate-200 hover:bg-white/10"
              onClick={() => setFitSignal((s) => s + 1)}
            >
              <Maximize2 size={16} aria-hidden />
            </IconButton>
            <IconButton
              label="Reload graph"
              className="text-slate-200 hover:bg-white/10"
              onClick={load}
            >
              <RefreshCw size={16} aria-hidden />
            </IconButton>
            <IconButton
              label="Open the vault in Obsidian"
              className="text-slate-200 hover:bg-white/10"
              onClick={() => void call('memory:openInObsidian', {})}
            >
              <ExternalLink size={16} aria-hidden />
            </IconButton>
          </div>
          {graph && graph.nodes.length === 0 && (
            <p className="absolute inset-0 m-auto h-fit text-center text-slate-400">
              Your brain is empty so far. Talk to Jarvis or write in Spaces, and notes appear here.
            </p>
          )}
          <p className="pointer-events-none absolute bottom-3 left-3 text-xs text-slate-500">
            {active?.hint}
          </p>
        </div>
      </div>
      {selected && (
        <aside
          aria-label="Selected note"
          className="flex w-80 shrink-0 flex-col border-l border-line-subtle lg:w-96"
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pr-2 pl-4">
            <span
              className="size-2.5 shrink-0 rounded-pill"
              style={{ background: colorOf(selected.group) }}
            />
            <h2 className="truncate text-ui font-semibold text-ink-100">{selected.title}</h2>
            <IconButton label="Close" className="ml-auto" onClick={() => select(null)}>
              <X size={16} aria-hidden />
            </IconButton>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="mb-3 truncate text-xs text-ink-500">
              {selected.id.replace(/^folder:/, '📂 ')}
            </p>
            {selected.group === 'folder' ? (
              <p className="text-sm text-ink-500">
                A folder with {Math.max(0, (deg.get(selected.id) ?? 1) - 1)} connections.
              </p>
            ) : note === null ? (
              <p className="text-sm text-ink-500">Loading…</p>
            ) : (
              <Markdown text={note} />
            )}
          </div>
          {selected.group !== 'folder' && (
            <footer className="flex flex-wrap gap-2 border-t border-line-subtle p-3">
              {spacePath ? (
                <Button onClick={() => go('spaces', `${spacePath[1]}/${spacePath[2]}`)}>
                  <NotebookPen size={14} aria-hidden /> Edit in Spaces
                </Button>
              ) : null}
              <Button
                onClick={() => void call('memory:openInObsidian', { vaultPath: selected.id })}
              >
                <ExternalLink size={14} aria-hidden /> Open in Obsidian
              </Button>
            </footer>
          )}
        </aside>
      )}
    </div>
  );
}
