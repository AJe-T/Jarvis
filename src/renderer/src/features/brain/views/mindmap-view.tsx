import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { PALETTE, folderTree, type BrainViewProps, type TreeNode } from '../brain-layout';
import { usePanZoom } from '../use-pan-zoom';

const ROW = 26;
const GAP = 46;
const CHAR = 6.6;
const BIG_VAULT = 120;

interface MNode {
  key: string;
  label: string;
  kind: 'root' | 'folder' | 'note';
  id: string | null;
  x: number;
  y: number;
  w: number;
  branch: number;
  hiddenCount: number;
  children: MNode[];
}

/** Tidy left-to-right tree: leaves get rows in order, a parent sits in the middle of its children. */
function layout(root: TreeNode, collapsed: Set<string>): MNode[] {
  const all: MNode[] = [];
  let row = 0;
  const visit = (
    t: TreeNode | null,
    note: { id: string; title: string } | null,
    x: number,
    branch: number,
    depth: number,
  ): MNode => {
    const label = note ? note.title : depth === 0 ? (t?.name ?? 'Vault') : (t?.name ?? '');
    const w = depth === 0 ? 0 : Math.min(260, label.length * CHAR + 14);
    const node: MNode = {
      key: note ? note.id : `dir:${t?.path ?? ''}`,
      label,
      kind: note ? 'note' : depth === 0 ? 'root' : 'folder',
      id: note?.id ?? null,
      x,
      y: 0,
      w,
      branch,
      hiddenCount: 0,
      children: [],
    };
    all.push(node);
    const closed = t && depth > 0 && collapsed.has(t.path);
    if (t && !closed) {
      const kids: Array<[TreeNode | null, { id: string; title: string } | null]> = [
        ...t.folders.map((f): [TreeNode, null] => [f, null]),
        ...t.notes.map((n): [null, { id: string; title: string }] => [null, n]),
      ];
      kids.forEach(([f, n], i) =>
        node.children.push(visit(f, n, x + w + GAP, depth === 0 ? i : branch, depth + 1)),
      );
    }
    if (t && closed) node.hiddenCount = t.count;
    if (node.children.length)
      node.y = ((node.children[0]?.y ?? 0) + (node.children[node.children.length - 1]?.y ?? 0)) / 2;
    else node.y = row++ * ROW;
    return node;
  };
  visit(root, null, 0, 0, 0);
  return all;
}

/** "Mind map": the vault's folders as a branching map, like Obsidian's mind-map plugin. */
export function MindmapView({
  nodes,
  hidden,
  selectedId,
  focus,
  fitSignal,
  onSelect,
}: BrainViewProps): React.JSX.Element {
  const tree = useMemo(
    () => folderTree(nodes.filter((n) => !hidden.has(n.group))),
    [nodes, hidden],
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (tree.count > BIG_VAULT)
      for (const f of tree.folders) for (const g of f.folders) s.add(g.path);
    return s;
  });
  const placed = useMemo(() => layout(tree, collapsed), [tree, collapsed]);
  const byKey = useMemo(() => new Map(placed.map((m) => [m.key, m])), [placed]);

  const bounds = useCallback(() => {
    if (!placed.length) return null;
    return {
      x0: -40,
      y0: Math.min(...placed.map((m) => m.y)) - 30,
      x1: Math.max(...placed.map((m) => m.x + m.w)) + 40,
      y1: Math.max(...placed.map((m) => m.y)) + 30,
    };
  }, [placed]);
  const { svgRef, gRef, fit, center, handlers } = usePanZoom(bounds, 2.5);
  useEffect(() => fit(), [fit, fitSignal]);
  useEffect(() => {
    if (!focus) return;
    // Open the folders on the way to the note, then centre it.
    const parts = focus.id.split('/').slice(0, -1);
    setCollapsed((c) => {
      const next = new Set(c);
      parts.forEach((_, i) => next.delete(parts.slice(0, i + 1).join('/')));
      return next;
    });
  }, [focus]);
  useEffect(() => {
    const m = focus && byKey.get(focus.id);
    if (m) center(m.x + m.w / 2, m.y, 1.2);
  }, [focus, byKey, center]);

  const toggle = (path: string): void =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="Mind map of the vault"
        {...handlers}
      >
        <rect width="100%" height="100%" fill="#1b1b1e" />
        <g ref={gRef}>
          {placed.map((m) =>
            m.children.map((c) => {
              const col = PALETTE[c.branch % PALETTE.length];
              const x0 = m.x + m.w;
              const mid = (x0 + c.x) / 2;
              return (
                <path
                  key={`${m.key}>${c.key}`}
                  d={`M${x0},${m.y} C${mid},${m.y} ${mid},${c.y} ${c.x},${c.y}`}
                  fill="none"
                  stroke={col}
                  strokeWidth={m.kind === 'root' ? 3 : 1.6}
                  strokeOpacity={0.9}
                />
              );
            }),
          )}
          {placed.map((m) => {
            const col = PALETTE[m.branch % PALETTE.length] ?? '#22d3ee';
            if (m.kind === 'root')
              return (
                <g key={m.key}>
                  <circle cx={0} cy={m.y} r={6} fill="#ffffff" stroke="#94a3b8" strokeWidth={2} />
                  <text
                    x={-12}
                    y={m.y + 4}
                    textAnchor="end"
                    fontSize={13}
                    fontWeight={600}
                    fill="#f1f5f9"
                  >
                    {m.label}
                  </text>
                </g>
              );
            const sel = m.id !== null && m.id === selectedId;
            const path = m.key.slice(4);
            return (
              <g
                key={m.key}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (m.kind === 'folder') toggle(path);
                  else onSelect(m.id);
                }}
              >
                <title>
                  {m.kind === 'folder'
                    ? `${path} — click to ${collapsed.has(path) ? 'open' : 'fold'}`
                    : m.label}
                </title>
                <rect x={m.x} y={m.y - 18} width={m.w} height={22} fill="transparent" />
                <line
                  x1={m.x}
                  y1={m.y}
                  x2={m.x + m.w}
                  y2={m.y}
                  stroke={col}
                  strokeWidth={sel ? 3 : 2}
                />
                <text
                  x={m.x + 2}
                  y={m.y - 5}
                  fontSize={12}
                  fill={sel ? '#ffffff' : m.kind === 'folder' ? '#f8fafc' : '#93c5fd'}
                  fontWeight={m.kind === 'folder' ? 600 : 400}
                  textDecoration={m.kind === 'note' ? 'underline' : undefined}
                >
                  {m.label.length > 38 ? `${m.label.slice(0, 37)}…` : m.label}
                </text>
                {m.kind === 'folder' && (
                  <>
                    <circle
                      cx={m.x + m.w}
                      cy={m.y}
                      r={5}
                      fill={m.hiddenCount ? col : '#ffffff'}
                      stroke={col}
                      strokeWidth={2}
                    />
                    {m.hiddenCount > 0 && (
                      <text x={m.x + m.w + 10} y={m.y + 4} fontSize={10} fill="#94a3b8">
                        +{m.hiddenCount}
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute top-16 right-3 flex gap-1 rounded-md bg-black/50 p-1 text-slate-200 backdrop-blur">
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs hover:bg-white/10"
        >
          <ChevronsUpDown size={14} aria-hidden /> Expand all
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set(tree.folders.map((f) => f.path)))}
          className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs hover:bg-white/10"
        >
          <ChevronsDownUp size={14} aria-hidden /> Fold all
        </button>
      </div>
    </div>
  );
}
