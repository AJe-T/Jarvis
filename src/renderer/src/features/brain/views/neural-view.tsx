import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { colorOf, type BrainViewProps } from '../brain-layout';
import { createSim, type SimLink, type SimNode } from '../graph-sim';

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

/** PRD F19 "Neural": every note a neuron, links as synapses with signals running along them. */
export function NeuralView({
  nodes,
  links,
  hidden,
  selectedId,
  focus,
  fitSignal,
  reduced,
  onSelect,
}: BrainViewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverTitle, setHoverTitle] = useState<{ title: string; x: number; y: number } | null>(
    null,
  );

  const sim = useMemo(() => createSim(nodes, links), [nodes, links]);
  const byId = useMemo(() => new Map(sim.nodes.map((n) => [n.id, n])), [sim]);

  // View state lives in refs: the canvas redraws every frame without React re-rendering.
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const hover = useRef<SimNode | null>(null);
  const selectedRef = useRef<SimNode | null>(null);
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    selectedRef.current = (selectedId && byId.get(selectedId)) || null;
  }, [selectedId, byId]);
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  const visible = (n: SimNode): boolean => !hiddenRef.current.has(n.group);

  /** Zoom and pan so every visible dot fits the canvas. */
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const shown = sim.nodes.filter((n) => !hiddenRef.current.has(n.group));
    if (!wrap || shown.length === 0) return;
    const xs = shown.map((n) => n.x);
    const ys = shown.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(
      (wrap.clientWidth * 0.8) / Math.max(x1 - x0, 1),
      (wrap.clientHeight * 0.8) / Math.max(y1 - y0, 1),
      2.2,
    );
    view.current = { k, tx: -((x0 + x1) / 2) * k, ty: -((y0 + y1) / 2) * k };
  }, [sim]);
  useEffect(() => {
    if (fitSignal) fit();
  }, [fitSignal, fit]);
  useEffect(() => {
    const n = focus && byId.get(focus.id);
    if (!n) return;
    const k = Math.max(view.current.k, 1.8);
    view.current = { k, tx: -n.x * k, ty: -n.y * k };
  }, [focus, byId]);

  // ── render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
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

      const focusNode = hover.current ?? selectedRef.current;
      const near = neighbours(focusNode);
      const lit = (n: SimNode): boolean => !focusNode || n === focusNode || near.has(n);

      for (const l of sim.links) {
        if (!visible(l.source) || !visible(l.target)) continue;
        const on = focusNode && (l.source === focusNode || l.target === focusNode);
        ctx.strokeStyle = on
          ? 'rgba(125, 211, 252, 0.85)'
          : focusNode
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

      // Signals travelling along synapses (off with reduced motion).
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

      const breathe = reduced ? 1 : 1 + Math.sin(time / 900) * 0.08;
      for (const n of sim.nodes) {
        if (!visible(n)) continue;
        const r = radiusOf(n);
        const c = colorOf(n.group);
        ctx.globalAlpha = lit(n) ? 1 : 0.15;
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.2 * breathe);
        g.addColorStop(0, `${c}aa`);
        g.addColorStop(1, `${c}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3.2 * breathe, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = n === focusNode ? '#ffffff' : c;
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
        const show = k > 1.6 || (focusNode && lit(n)) || n.degree > 12 || sim.nodes.length <= 60;
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

  // ── interaction ──
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

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Brain graph: ${nodes.filter((n) => n.group !== 'folder').length} notes and their links`}
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
              sim.reheat(0.15);
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
          if (d && !d.moved) onSelect(d.node?.id ?? null);
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
    </div>
  );
}
