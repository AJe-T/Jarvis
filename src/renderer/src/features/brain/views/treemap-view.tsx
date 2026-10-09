import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import clsx from 'clsx';
import {
  colorOf,
  findFolder,
  folderTree,
  squarify,
  type BrainViewProps,
  type GNode,
  type Rect,
  type TreeNode,
} from '../brain-layout';

type Metric = 'count' | 'bytes';
type Tile = { key: string; value: number; folder: TreeNode | null; note: GNode | null };

const HEADER = 22;
const MIN_PREVIEW = 70;

function tilesOf(t: TreeNode, metric: Metric): Tile[] {
  return [
    ...t.folders.map((f) => ({
      key: `dir:${f.path}`,
      value: metric === 'count' ? f.count : f.bytes,
      folder: f,
      note: null,
    })),
    ...t.notes.map((n) => ({
      key: n.id,
      value: metric === 'count' ? 1 : Math.max(1, n.size),
      folder: null,
      note: n,
    })),
  ];
}

/** "Treemap": the vault as nested boxes sized by notes (or bytes); click a folder to step inside. */
export function TreemapView({
  nodes,
  hidden,
  selectedId,
  focus,
  onSelect,
}: BrainViewProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [path, setPath] = useState('');
  const [metric, setMetric] = useState<Metric>('count');
  const tree = useMemo(
    () => folderTree(nodes.filter((n) => !hidden.has(n.group))),
    [nodes, hidden],
  );
  const here = findFolder(tree, path);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (focus) setPath(focus.id.includes('/') ? focus.id.slice(0, focus.id.lastIndexOf('/')) : '');
  }, [focus]);

  const rects = useMemo(
    () => squarify(tilesOf(here, metric), { x: 0, y: 0, w: size.w, h: size.h }),
    [here, metric, size],
  );
  const crumbs = path ? path.split('/') : [];

  const preview = (f: TreeNode, r: Rect): React.JSX.Element[] =>
    r.w < MIN_PREVIEW || r.h < MIN_PREVIEW
      ? []
      : squarify(tilesOf(f, metric), { x: 4, y: HEADER, w: r.w - 8, h: r.h - HEADER - 4 }).map(
          (s) => (
            <div
              key={s.key}
              className="absolute rounded-xs border border-black/40"
              style={{
                left: s.x,
                top: s.y,
                width: Math.max(0, s.w - 2),
                height: Math.max(0, s.h - 2),
                background: `${colorOf(s.folder ? s.folder.path : (s.note?.group ?? ''))}${s.folder ? '55' : '33'}`,
              }}
              title={s.folder ? s.folder.name : s.note?.title}
            />
          ),
        );

  return (
    <div className="flex h-full w-full flex-col bg-[#0b0d12] p-3 pt-16 pb-8">
      <div className="mb-2 flex items-center gap-1 pl-64 text-sm text-slate-300">
        <button
          type="button"
          onClick={() => setPath('')}
          className="rounded-sm px-1.5 py-0.5 hover:bg-white/10"
        >
          {tree.name}
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={13} aria-hidden className="text-slate-500" />
            <button
              type="button"
              onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}
              className="rounded-sm px-1.5 py-0.5 hover:bg-white/10"
            >
              {c}
            </button>
          </span>
        ))}
        <span className="ml-2 text-xs text-slate-500">{here.count} notes</span>
        <div
          className="ml-auto flex rounded-sm border border-white/15 p-0.5 text-xs"
          role="radiogroup"
          aria-label="Box size"
        >
          {(['count', 'bytes'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metric === m}
              onClick={() => setMetric(m)}
              className={clsx(
                'rounded-xs px-2 py-0.5',
                metric === m ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white',
              )}
            >
              {m === 'count' ? 'By notes' : 'By size'}
            </button>
          ))}
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        {rects.map((r) => {
          const f = r.folder;
          const n = r.note;
          const col = colorOf(f ? f.path : (n?.group ?? ''));
          const big = r.w > 60 && r.h > 28;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => (f ? setPath(f.path) : n && onSelect(n.id))}
              title={f ? `${f.path} · ${f.count} notes — click to open` : n?.title}
              className={clsx(
                'group absolute overflow-hidden rounded-sm border text-left transition-[filter] hover:brightness-125',
                n && n.id === selectedId ? 'z-10 border-white' : 'border-black/50',
              )}
              style={{
                left: r.x + 1,
                top: r.y + 1,
                width: Math.max(0, r.w - 2),
                height: Math.max(0, r.h - 2),
                background: f
                  ? `linear-gradient(160deg, ${col}40, ${col}18)`
                  : `linear-gradient(160deg, ${col}cc, ${col}77)`,
              }}
            >
              {big && (
                <span
                  className={clsx(
                    'absolute top-1 right-1.5 left-1.5 flex items-center gap-1 truncate text-xs',
                    f ? 'font-semibold text-white' : 'text-slate-950',
                  )}
                >
                  {f ? <Folder size={11} aria-hidden /> : <FileText size={11} aria-hidden />}
                  <span className="truncate">{f ? f.name : n?.title}</span>
                  {f && (
                    <span className="ml-auto shrink-0 font-normal text-white/60">{f.count}</span>
                  )}
                </span>
              )}
              {f && preview(f, r)}
            </button>
          );
        })}
        {rects.length === 0 && (
          <p className="absolute inset-0 m-auto h-fit text-center text-sm text-slate-500">
            This folder is empty.
          </p>
        )}
      </div>
    </div>
  );
}
