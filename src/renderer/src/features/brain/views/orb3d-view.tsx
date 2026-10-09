import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import clsx from 'clsx';
import { colorOf, degrees, sphereLayout, type BrainViewProps } from '../brain-layout';

const FOV = 900;
const STARS = 280;

interface Shown {
  id: string;
  title: string;
  sx: number;
  sy: number;
  r: number;
}

/** "3D Orbs": every note a glossy orb in a slowly turning galaxy; drag to spin, scroll to fly in. */
export function Orb3DView({
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
  const [auto, setAuto] = useState(!reduced);
  const [hoverTitle, setHoverTitle] = useState<{ title: string; x: number; y: number } | null>(
    null,
  );

  const notes = useMemo(
    () => nodes.filter((n) => n.group !== 'folder' && !hidden.has(n.group)),
    [nodes, hidden],
  );
  const pos = useMemo(() => sphereLayout(notes, 140 + Math.sqrt(notes.length) * 40), [notes]);
  const deg = useMemo(() => degrees(links.filter((l) => l.kind === 'link')), [links]);
  const pairs = useMemo(
    () => links.filter((l) => l.kind === 'link' && pos.has(l.source) && pos.has(l.target)),
    [links, pos],
  );
  const extent = useMemo(
    () => Math.max(200, ...[...pos.values()].map((p) => Math.hypot(p.x, p.y, p.z))),
    [pos],
  );
  const stars = useMemo(
    () =>
      Array.from({ length: STARS }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: Math.random() * 1.1 + 0.2,
        p: Math.random() * 6.3,
      })),
    [],
  );

  const cam = useRef({ yaw: 0.6, pitch: -0.25, dist: 1100 });
  const autoRef = useRef(auto);
  const shown = useRef<Shown[]>([]);
  const hover = useRef<string | null>(null);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    autoRef.current = auto;
  }, [auto]);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    cam.current.dist = extent * 2 + 150;
  }, [extent, fitSignal]);
  useEffect(() => {
    const p = focus && pos.get(focus.id);
    if (!p) return;
    const yaw = Math.atan2(p.x, p.z) + Math.PI;
    const z1 = p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
    cam.current = { yaw, pitch: Math.atan2(p.y, -z1) * -1, dist: Math.max(500, extent * 1.2) };
    setAuto(false);
  }, [focus, pos, extent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !wrap || !ctx) return;
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
    let raf = 0;

    const frame = (time: number): void => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const c = cam.current;
      if (autoRef.current && !reduced) c.yaw += 0.0012;
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
      bg.addColorStop(0, '#0b1433');
      bg.addColorStop(0.6, '#050a1c');
      bg.addColorStop(1, '#010309');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        ctx.globalAlpha = reduced ? 0.6 : 0.35 + Math.sin(time / 700 + s.p) * 0.3;
        ctx.fillStyle = '#e0f2fe';
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const cy = Math.cos(c.yaw);
      const sy = Math.sin(c.yaw);
      const cp = Math.cos(c.pitch);
      const sp = Math.sin(c.pitch);
      const proj = new Map<string, { sx: number; sy: number; f: number; depth: number }>();
      for (const [id, p] of pos) {
        const x1 = p.x * cy - p.z * sy;
        const z1 = p.x * sy + p.z * cy;
        const y1 = p.y * cp - z1 * sp;
        const z2 = p.y * sp + z1 * cp;
        const depth = z2 + c.dist;
        if (depth < 40) continue;
        const f = FOV / depth;
        proj.set(id, { sx: w / 2 + x1 * f * dpr, sy: h / 2 + y1 * f * dpr, f, depth });
      }
      const focusId = hover.current ?? selectedRef.current;

      // Links, brighter when near and when touching the focused orb.
      for (const l of pairs) {
        const a = proj.get(l.source);
        const b = proj.get(l.target);
        if (!a || !b) continue;
        const on = focusId !== null && (l.source === focusId || l.target === focusId);
        ctx.strokeStyle = on
          ? 'rgba(186, 230, 253, 0.85)'
          : `rgba(148, 197, 255, ${Math.min(0.3, ((a.f + b.f) / 2) * 0.22)})`;
        ctx.lineWidth = (on ? 1.4 : 0.7) * dpr;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      const order = notes
        .filter((n) => proj.has(n.id))
        .sort((a, b) => (proj.get(b.id)?.depth ?? 0) - (proj.get(a.id)?.depth ?? 0));
      const list: Shown[] = [];
      for (const n of order) {
        const p = proj.get(n.id);
        if (!p) continue;
        const col = colorOf(n.group);
        const r =
          (8 + Math.min(12, Math.sqrt(deg.get(n.id) ?? 0) * 2.5)) * (extent / 350) * p.f * dpr;
        const fade = Math.max(0.25, Math.min(1, (p.f - 0.3) / 0.7));
        const isFocus = n.id === focusId;
        ctx.globalAlpha = fade;
        // Halo
        const halo = ctx.createRadialGradient(p.sx, p.sy, r * 0.6, p.sx, p.sy, r * 2.2);
        halo.addColorStop(0, `${col}66`);
        halo.addColorStop(1, `${col}00`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        // Glass body: bright core offset up-left, the folder colour in the middle, a dark rim.
        const body = ctx.createRadialGradient(
          p.sx - r * 0.35,
          p.sy - r * 0.4,
          r * 0.05,
          p.sx,
          p.sy,
          r,
        );
        body.addColorStop(0, 'rgba(255,255,255,0.95)');
        body.addColorStop(0.28, `${col}ee`);
        body.addColorStop(0.85, `${col}55`);
        body.addColorStop(1, 'rgba(2,6,23,0.9)');
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isFocus ? '#ffffff' : `${col}cc`;
        ctx.lineWidth = (isFocus ? 2 : 1) * dpr;
        ctx.stroke();
        // Specular sweep
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(1, r * 0.12);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r * 0.68, Math.PI * 1.1, Math.PI * 1.45);
        ctx.stroke();
        if (n.id === selectedRef.current) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r + 5 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
        list.push({ id: n.id, title: n.title, sx: p.sx / dpr, sy: p.sy / dpr, r: r / dpr });
        if (isFocus || r > 10 * dpr || notes.length <= 40) {
          ctx.globalAlpha = Math.min(1, fade + 0.2);
          ctx.font = `${Math.max(10, Math.min(16, 11 * p.f)) * dpr}px Geist, "Segoe UI", sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = isFocus ? '#ffffff' : 'rgba(254, 240, 168, 0.92)';
          ctx.fillText(n.title.slice(0, 36), p.sx, p.sy - r - 6 * dpr);
        }
      }
      ctx.globalAlpha = 1;
      shown.current = list.reverse(); // nearest first for hit tests
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [notes, pos, pairs, deg, stars, reduced, extent]);

  const hit = (e: React.PointerEvent): Shown | null => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return shown.current.find((s) => (s.sx - x) ** 2 + (s.sy - y) ** 2 <= (s.r + 4) ** 2) ?? null;
  };
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const spin = (by: number): void => {
    cam.current.yaw += by;
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`3D brain: ${notes.length} notes as orbs`}
        className={clsx(
          'block',
          hoverTitle ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        )}
        onWheel={(e) => {
          cam.current.dist = Math.min(
            extent * 6 + 1000,
            Math.max(120, cam.current.dist * Math.exp(e.deltaY * 0.0012)),
          );
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            cam.current.yaw += dx * 0.005;
            cam.current.pitch = Math.max(-1.35, Math.min(1.35, cam.current.pitch + dy * 0.005));
            d.x = e.clientX;
            d.y = e.clientY;
            return;
          }
          const s = hit(e);
          hover.current = s?.id ?? null;
          setHoverTitle(s ? { title: s.title, x: e.clientX, y: e.clientY } : null);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) onSelect(hit(e)?.id ?? null);
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
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-pill bg-black/50 p-1 text-slate-200 backdrop-blur">
        <button
          type="button"
          aria-label="Turn left"
          onClick={() => spin(-Math.PI / 6)}
          className="grid size-8 place-items-center rounded-pill hover:bg-white/10"
        >
          <RotateCcw size={15} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={auto ? 'Stop spinning' : 'Spin slowly'}
          aria-pressed={auto}
          onClick={() => setAuto((a) => !a)}
          className="grid size-9 place-items-center rounded-pill border border-white/20 hover:bg-white/10"
        >
          {auto ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label="Turn right"
          onClick={() => spin(Math.PI / 6)}
          className="grid size-8 place-items-center rounded-pill hover:bg-white/10"
        >
          <RotateCw size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}
