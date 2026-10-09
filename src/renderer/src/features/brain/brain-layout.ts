import { hash } from './graph-sim';

/** Pure layouts for the Brain's other views: folder tree, treemap, hulls, clusters, 3D sphere. */

export interface GNode {
  id: string;
  title: string;
  group: string;
  size: number;
}
export interface GLink {
  source: string;
  target: string;
  kind: 'link' | 'folder';
}

/** Neon palette for folders; the Brain keeps a dark canvas in both themes on purpose. */
export const PALETTE = [
  '#22d3ee',
  '#a78bfa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#60a5fa',
  '#fb7185',
  '#2dd4bf',
  '#c084fc',
  '#f97316',
  '#a3e635',
  '#38bdf8',
];
export const colorOf = (group: string): string =>
  group === 'folder' ? '#e2e8f0' : (PALETTE[hash(group) % PALETTE.length] ?? '#22d3ee');

export function degrees(links: GLink[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const l of links) {
    d.set(l.source, (d.get(l.source) ?? 0) + 1);
    d.set(l.target, (d.get(l.target) ?? 0) + 1);
  }
  return d;
}

// ── folder tree (mind map, treemap) ──────────────────────────────────────────────────────────

export interface TreeNode {
  name: string;
  /** "" for the root, else "Memory/People". */
  path: string;
  folders: TreeNode[];
  notes: GNode[];
  /** Notes in this folder and below. */
  count: number;
  bytes: number;
}

export function folderTree(nodes: GNode[], rootName = 'Vault'): TreeNode {
  const root: TreeNode = { name: rootName, path: '', folders: [], notes: [], count: 0, bytes: 0 };
  const byPath = new Map<string, TreeNode>([['', root]]);
  const dir = (path: string): TreeNode => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const cut = path.lastIndexOf('/');
    const parent = dir(cut < 0 ? '' : path.slice(0, cut));
    const node: TreeNode = {
      name: path.slice(cut + 1),
      path,
      folders: [],
      notes: [],
      count: 0,
      bytes: 0,
    };
    parent.folders.push(node);
    byPath.set(path, node);
    return node;
  };
  for (const n of nodes) {
    if (n.group === 'folder' || n.id.startsWith('folder:')) continue;
    const cut = n.id.lastIndexOf('/');
    dir(cut < 0 ? '' : n.id.slice(0, cut)).notes.push(n);
  }
  const total = (t: TreeNode): void => {
    t.folders.sort((a, b) => a.name.localeCompare(b.name));
    t.notes.sort((a, b) => a.title.localeCompare(b.title));
    for (const f of t.folders) total(f);
    t.count = t.notes.length + t.folders.reduce((s, f) => s + f.count, 0);
    t.bytes =
      t.notes.reduce((s, n) => s + Math.max(1, n.size), 0) +
      t.folders.reduce((s, f) => s + f.bytes, 0);
  };
  total(root);
  return root;
}

export function findFolder(root: TreeNode, path: string): TreeNode {
  if (!path) return root;
  let cur = root;
  for (const part of path.split('/')) {
    const next = cur.folders.find((f) => f.name === part);
    if (!next) return cur;
    cur = next;
  }
  return cur;
}

// ── squarified treemap (Bruls, Huizing & van Wijk) ──────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function squarify<T extends { value: number }>(items: T[], box: Rect): Array<T & Rect> {
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (!total || box.w <= 0 || box.h <= 0) return [];
  const scale = (box.w * box.h) / total;
  const out: Array<T & Rect> = [];
  let rest = { ...box };
  let row: T[] = [];
  const worst = (r: T[], side: number): number => {
    const areas = r.map((i) => i.value * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const lay = (r: T[]): void => {
    const sum = r.reduce((s, i) => s + i.value * scale, 0);
    const horizontal = rest.w >= rest.h;
    const thick = horizontal ? sum / rest.h : sum / rest.w;
    let off = 0;
    for (const i of r) {
      const len = (i.value * scale) / thick;
      out.push(
        horizontal
          ? { ...i, x: rest.x, y: rest.y + off, w: thick, h: len }
          : { ...i, x: rest.x + off, y: rest.y, w: len, h: thick },
      );
      off += len;
    }
    rest = horizontal
      ? { x: rest.x + thick, y: rest.y, w: rest.w - thick, h: rest.h }
      : { x: rest.x, y: rest.y + thick, w: rest.w, h: rest.h - thick };
  };
  for (const item of sorted) {
    const side = Math.min(rest.w, rest.h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else {
      lay(row);
      row = [item];
    }
  }
  if (row.length) lay(row);
  return out;
}

// ── convex hull (Andrew's monotone chain) ───────────────────────────────────────────────────

export type Pt = { x: number; y: number };

export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2] as Pt, lower[lower.length - 1] as Pt, q) <= 0
    )
      lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2] as Pt, upper[upper.length - 1] as Pt, q) <= 0
    )
      upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** A soft blob around points: the hull pushed out by `pad`, drawn with curves through the midpoints. */
export function blobPath(points: Pt[], pad: number): string {
  if (points.length === 0) return '';
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  let hull = convexHull(points);
  if (hull.length < 3) {
    // One or two dots: a circle-ish blob around them.
    hull = Array.from({ length: 8 }, (_, i) => ({
      x: cx + Math.cos((i / 8) * Math.PI * 2) * 1,
      y: cy + Math.sin((i / 8) * Math.PI * 2) * 1,
    }));
  }
  const out = hull.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * pad, y: p.y + (dy / d) * pad };
  });
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const n = out.length;
  const start = mid(out[n - 1] as Pt, out[0] as Pt);
  let d = `M${start.x.toFixed(1)},${start.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p = out[i] as Pt;
    const m = mid(p, out[(i + 1) % n] as Pt);
    d += ` Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${m.x.toFixed(1)},${m.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

// ── clusters (hull view, constellation view) ────────────────────────────────────────────────

export interface ClusterInfo {
  group: string;
  cx: number;
  cy: number;
  r: number;
  members: string[];
}

/**
 * Each folder is a cluster on a loose grid (biggest first); inside, notes sit on a sunflower spiral
 * with the best-connected ones in the middle.
 */
export function clusterLayout(
  nodes: GNode[],
  deg: Map<string, number>,
  spacing = 14,
): { pos: Map<string, Pt>; clusters: ClusterInfo[] } {
  const groups = new Map<string, GNode[]>();
  for (const n of nodes)
    if (n.group !== 'folder') groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const pos = new Map<string, Pt>();
  const radii = ordered.map(([, m]) => spacing * Math.sqrt(m.length) + spacing * 2.5);
  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.4)));
  const cell = Math.max(...radii, 40) * 2 + 60;
  const clusters: ClusterInfo[] = ordered.map(([group, members], i) => {
    const row = Math.floor(i / cols);
    // Odd rows shift half a cell: a honeycomb reads less like a spreadsheet.
    const cx = (i % cols) * cell + (row % 2 ? cell / 2 : 0) + (hash(group) % 40) - 20;
    const cy = row * cell * 0.86 + (hash(`${group}y`) % 40) - 20;
    const sorted = [...members].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0));
    sorted.forEach((n, k) => {
      const r = spacing * Math.sqrt(k + 0.5);
      const a = k * 2.399963;
      pos.set(n.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    });
    return { group, cx, cy, r: radii[i] ?? 40, members: sorted.map((n) => n.id) };
  });
  return { pos, clusters };
}

// ── 3D sphere ───────────────────────────────────────────────────────────────────────────────

export type P3 = { x: number; y: number; z: number };

const fib = (i: number, n: number): P3 => {
  const y = 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.399963;
  return { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
};

/** Folders spread over a big sphere; each folder's notes form a small ball around its spot. */
export function sphereLayout(nodes: GNode[], radius = 420): Map<string, P3> {
  const groups = new Map<string, GNode[]>();
  for (const n of nodes) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  const keys = [...groups.keys()].sort(
    (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0),
  );
  const out = new Map<string, P3>();
  keys.forEach((g, gi) => {
    const c = keys.length === 1 ? { x: 0, y: 0, z: 0 } : fib(gi, keys.length);
    const members = groups.get(g) ?? [];
    const rg = 24 + Math.sqrt(members.length) * 16;
    members.forEach((n, i) => {
      const p = members.length === 1 ? { x: 0, y: 0, z: 0 } : fib(i, members.length);
      const shell = 0.45 + ((hash(n.id) % 100) / 100) * 0.55;
      out.set(n.id, {
        x: c.x * radius + p.x * rg * shell,
        y: c.y * radius + p.y * rg * shell,
        z: c.z * radius + p.z * rg * shell,
      });
    });
  });
  return out;
}

/** What every Brain view gets from the shell. */
export interface BrainViewProps {
  /** Notes (and folder hubs when "Show folders" is on). */
  nodes: GNode[];
  links: GLink[];
  /** Folder groups Sir switched off in the legend. */
  hidden: Set<string>;
  selectedId: string | null;
  /** Search result to bring into view (serial changes on every search). */
  focus: { id: string; serial: number } | null;
  /** Bumped by the Fit button. */
  fitSignal: number;
  reduced: boolean;
  onSelect(id: string | null): void;
}
