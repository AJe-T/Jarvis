import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Maximize2, NotebookPen, RefreshCw, Search, X } from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Markdown } from '../../components/jarvis/chat-message';
import { Button, IconButton } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { useMemoryStore } from '../../stores/memory-store';
import { useUiStore } from '../../stores/ui-store';
import { createSim, hash, type SimLink, type SimNode } from './graph-sim';

type Graph = Res<'memory:graph'>;

/** Neon palette for folders; the graph keeps a dark "neural" canvas in both themes on purpose. */
const PALETTE = [
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
const colorOf = (group: string): string =>
  group === 'folder' ? '#e2e8f0' : (PALETTE[hash(group) % PALETTE.length] ?? '#22d3ee');
const radiusOf = (n: SimNode): number =>
  n.group === 'folder'
    ? 3 + Math.min(6, Math.sqrt(n.degree))
    : 2.5 + Math.min(7, Math.sqrt(n.degree) * 1.4);

interface Pulse {
  link: SimLink;
  t: number;
  speed: number;
  forward: boolean;
}

function stripFm(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** PRD F19: the Brain — every note in the vault as a neuron, links as synapses. */
export function BrainView(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [showFolders, setShowFolders] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hoverTitle, setHoverTitle] = useState<{ title: string; x: number; y: number } | null>(
    null,
  );
  const version = useMemoryStore((s) => s.version);
  const reduced = useReducedMotion();
  const go = useUiStore((s) => s.go);

  const load = useCallback(() => {
    void call('memory:graph', {})
      .then(setGraph)
      .catch(() => setGraph({ nodes: [], links: [] }));
  }, []);
  useEffect(load, [load, version]);

  const sim = useMemo(() => {
    if (!graph) return null;
    const nodes = graph.nodes.filter((n) => showFolders || n.group !== 'folder');
    const ids = new Set(nodes.map((n) => n.id));
    return createSim(
      nodes,
      graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)),
    );
  }, [graph, showFolders]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graph?.nodes ?? [])
      if (n.group !== 'folder') counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  // View state lives in refs: the canvas redraws every frame without React re-rendering.
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const hover = useRef<SimNode | null>(null);
  const selectedRef = useRef<SimNode | null>(null);
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  const visible = (n: SimNode): boolean => !hiddenRef.current.has(n.group);

  /** Zoom and pan so every visible dot fits the canvas. */
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const nodes = sim?.nodes.filter((n) => !hiddenRef.current.has(n.group)) ?? [];
    if (!wrap || nodes.length === 0) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(
      (wrap.clientWidth * 0.8) / Math.max(x1 - x0, 1),
      (wrap.clientHeight * 0.8) / Math.max(y1 - y0, 1),
      2.2,
    );
    view.current = { k, tx: -((x0 + x1) / 2) * k, ty: -((y0 + y1) / 2) * k };
  }, [sim]);

  // ── render loop ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !sim) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const pulses: Pulse[] = [];
    const neighbours = (n: SimNode | null): Set<SimNode> => {
      const out = new Set<SimNode>();
      if (!n) return out;
      for (const l of sim.links) {
        if (l.source === n) out.add(l.target);
        if (l.target === n) out.add(l.source);
      }
      return out;
    };

    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(wrap.clientWidth * dpr);
      canvas.height = Math.round(wrap.clientHeight * dpr);
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    // Fit the brain on first show.
    view.current = {
      k: Math.min(wrap.clientWidth / 1200, wrap.clientHeight / 900, 1.4) || 1,
      tx: 0,
      ty: 0,
    };

    let ticks = 0;
    const frame = (time: number): void => {
      sim.tick();
      // Frame the brain once the layout has mostly settled (and again shortly after).
      if (++ticks === 60 || ticks === 220) fit();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const { k, tx, ty } = view.current;
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      bg.addColorStop(0, '#0b1426');
      bg.addColorStop(1, '#03060d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + tx * dpr, h / 2 + ty * dpr);
      ctx.scale(k * dpr, k * dpr);

      const focus = hover.current ?? selectedRef.current;
      const near = neighbours(focus);
      const lit = (n: SimNode): boolean => !focus || n === focus || near.has(n);

      // Synapses
      for (const l of sim.links) {
        if (!visible(l.source) || !visible(l.target)) continue;
        const on = focus && (l.source === focus || l.target === focus);
        ctx.strokeStyle = on
          ? 'rgba(125, 211, 252, 0.85)'
          : focus
            ? 'rgba(148, 163, 184, 0.05)'
            : l.kind === 'link'
              ? 'rgba(125, 211, 252, 0.28)'
              : 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = (on ? 1.4 : l.kind === 'link' ? 0.9 : 0.6) / Math.sqrt(k);
        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
        ctx.stroke();
      }

      // Signals travelling along synapses (off with reduced motion)
      if (!reduced && sim.links.length) {
        while (pulses.length < Math.min(60, sim.links.length)) {
          const link = sim.links[Math.floor(Math.random() * sim.links.length)] as SimLink;
          pulses.push({
            link,
            t: 0,
            speed: 0.006 + Math.random() * 0.012,
            forward: Math.random() < 0.5,
          });
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i] as Pulse;
          p.t += p.speed;
          if (p.t >= 1 || !visible(p.link.source) || !visible(p.link.target)) {
            pulses.splice(i, 1);
            continue;
          }
          const a = p.forward ? p.link.source : p.link.target;
          const b = p.forward ? p.link.target : p.link.source;
          const x = a.x + (b.x - a.x) * p.t;
          const y = a.y + (b.y - a.y) * p.t;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 6 / Math.sqrt(k));
          glow.addColorStop(0, 'rgba(240, 249, 255, 0.95)');
          glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, 6 / Math.sqrt(k), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Neurons
      const breathe = reduced ? 1 : 1 + Math.sin(time / 900) * 0.08;
      for (const n of sim.nodes) {
        if (!visible(n)) continue;
        const r = radiusOf(n);
        const c = colorOf(n.group);
        const dim = !lit(n);
        ctx.globalAlpha = dim ? 0.15 : 1;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.2 * breathe);
        g.addColorStop(0, `${c}aa`);
        g.addColorStop(1, `${c}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3.2 * breathe, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = n === focus ? '#ffffff' : c;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n === selectedRef.current) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4 / k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Labels: zoomed in, the focused neighbourhood, and the busiest hubs.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `${12 / k}px Geist, "Segoe UI", sans-serif`;
      for (const n of sim.nodes) {
        if (!visible(n)) continue;
        const show = k > 1.6 || (focus && lit(n)) || n.degree > 12 || sim.nodes.length <= 60;
        if (!show) continue;
        ctx.fillStyle = lit(n) ? 'rgba(226, 232, 240, 0.92)' : 'rgba(226, 232, 240, 0.25)';
        ctx.fillText(n.title.slice(0, 40), n.x, n.y + radiusOf(n) + 3 / k);
      }
      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [sim, reduced, fit]);

  // ── interaction ────────────────────────────────────────────────────────────────────────────
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const { k, tx, ty } = view.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - tx) / k,
      y: (clientY - rect.top - rect.height / 2 - ty) / k,
    };
  };
  const hit = (clientX: number, clientY: number): SimNode | null => {
    if (!sim) return null;
    const p = toWorld(clientX, clientY);
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of sim.nodes) {
      if (!visible(n)) continue;
      const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      const r = radiusOf(n) + 6 / view.current.k;
      if (d < r * r && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const drag = useRef<{ node: SimNode | null; x: number; y: number; moved: boolean } | null>(null);

  function select(n: SimNode | null): void {
    setSelected(n);
    setNote(null);
    if (n && n.group !== 'folder')
      void call('memory:read', { vaultPath: n.id })
        .then((r) => setNote(stripFm(r.markdown)))
        .catch(() => setNote('_This note could not be opened._'));
  }

  function centerOn(n: SimNode): void {
    view.current = { k: Math.max(view.current.k, 1.8), tx: 0, ty: 0 };
    view.current.tx = -n.x * view.current.k;
    view.current.ty = -n.y * view.current.k;
  }

  function search(): void {
    const q = query.trim().toLowerCase();
    if (!q || !sim) return;
    const n =
      sim.nodes.find((x) => x.title.toLowerCase() === q) ??
      sim.nodes.find((x) => x.title.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
    if (n) {
      centerOn(n);
      select(n);
    }
  }

  const spacePath = selected && /^Spaces\/([^/]+)\/(.+)\.md$/.exec(selected.id);

  return (
    <div className="flex min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#03060d]">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Brain graph: ${graph?.nodes.filter((n) => n.group !== 'folder').length ?? 0} notes and their links`}
            className={clsx('block', hoverTitle ? 'cursor-pointer' : 'cursor-grab')}
            onWheel={(e) => {
              const v = view.current;
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = e.clientX - rect.left - rect.width / 2;
              const my = e.clientY - rect.top - rect.height / 2;
              const k = Math.min(6, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
              v.tx = mx - ((mx - v.tx) * k) / v.k;
              v.ty = my - ((my - v.ty) * k) / v.k;
              v.k = k;
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const node = hit(e.clientX, e.clientY);
              if (node) node.fixed = true;
              drag.current = { node, x: e.clientX, y: e.clientY, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) {
                const dx = e.clientX - d.x;
                const dy = e.clientY - d.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
                if (d.node) {
                  const p = toWorld(e.clientX, e.clientY);
                  d.node.x = p.x;
                  d.node.y = p.y;
                  sim?.reheat(0.15);
                } else {
                  view.current.tx += dx;
                  view.current.ty += dy;
                }
                d.x = e.clientX;
                d.y = e.clientY;
                return;
              }
              const n = hit(e.clientX, e.clientY);
              hover.current = n;
              setHoverTitle(n ? { title: n.title, x: e.clientX, y: e.clientY } : null);
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d?.node) d.node.fixed = false;
              if (d && !d.moved) select(d.node);
            }}
            onPointerLeave={() => {
              hover.current = null;
              setHoverTitle(null);
            }}
          />
          {hoverTitle && (
            <div
              className="pointer-events-none fixed z-30 rounded-sm bg-black/80 px-2 py-1 text-xs text-white"
              style={{ left: hoverTitle.x + 12, top: hoverTitle.y + 12 }}
            >
              {hoverTitle.title}
            </div>
          )}
          {/* Controls float over the canvas */}
          <div className="absolute top-3 left-3 flex flex-col gap-2">
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
                className="h-8 min-h-8 w-48 border-transparent bg-transparent text-sm text-white placeholder:text-slate-400"
              />
            </form>
            <div className="max-h-[50vh] max-w-60 overflow-y-auto rounded-md bg-black/50 p-2 text-xs text-slate-200 backdrop-blur">
              <p className="mb-1 font-semibold text-white">
                {graph?.nodes.filter((n) => n.group !== 'folder').length ?? 0} notes ·{' '}
                {graph?.links.filter((l) => l.kind === 'link').length ?? 0} links
              </p>
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
                Show folders
              </label>
            </div>
          </div>
          <div className="absolute top-3 right-3 flex gap-1 rounded-md bg-black/50 p-1 text-white backdrop-blur">
            <IconButton
              label="Fit to screen"
              className="text-slate-200 hover:bg-white/10"
              onClick={fit}
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
            Scroll to zoom · drag to move · click a dot to read it
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
                A folder with {selected.degree - 1} connections.
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
