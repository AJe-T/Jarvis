import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  blobPath,
  clusterLayout,
  colorOf,
  degrees,
  type BrainViewProps,
  type Pt,
} from '../brain-layout';
import { usePanZoom } from '../use-pan-zoom';

const HUB = '#f59e0b';

/**
 * "Clusters" (soft hulls around each folder, Obsidian-canvas style) and "Constellations" (each folder a
 * star with its notes around it, like Obsidian's local graph). Same layout, two looks.
 */
export function ClusterView({
  nodes,
  links,
  hidden,
  selectedId,
  focus,
  fitSignal,
  onSelect,
  variant,
}: BrainViewProps & { variant: 'hulls' | 'stars' }): React.JSX.Element {
  const [hover, setHover] = useState<string | null>(null);
  const notes = useMemo(
    () => nodes.filter((n) => n.group !== 'folder' && !hidden.has(n.group)),
    [nodes, hidden],
  );
  const deg = useMemo(() => degrees(links.filter((l) => l.kind === 'link')), [links]);
  const { pos, clusters } = useMemo(
    () => clusterLayout(notes, deg, variant === 'stars' ? 16 : 14),
    [notes, deg, variant],
  );
  const wires = useMemo(
    () => links.filter((l) => l.kind === 'link' && pos.has(l.source) && pos.has(l.target)),
    [links, pos],
  );
  const near = useMemo(() => {
    const f = hover ?? selectedId;
    const s = new Set<string>();
    if (f)
      for (const l of wires)
        if (l.source === f) s.add(l.target);
        else if (l.target === f) s.add(l.source);
    return s;
  }, [hover, selectedId, wires]);

  const bounds = useCallback(() => {
    if (!clusters.length) return null;
    return {
      x0: Math.min(...clusters.map((c) => c.cx - c.r)),
      y0: Math.min(...clusters.map((c) => c.cy - c.r)) - 30,
      x1: Math.max(...clusters.map((c) => c.cx + c.r)),
      y1: Math.max(...clusters.map((c) => c.cy + c.r)),
    };
  }, [clusters]);
  const { svgRef, gRef, fit, center, handlers } = usePanZoom(bounds);
  useEffect(() => fit(), [fit, fitSignal]);
  useEffect(() => {
    const p = focus && pos.get(focus.id);
    if (p) center(p.x, p.y, 2);
  }, [focus, pos, center]);

  const focusId = hover ?? selectedId;
  const lit = (id: string): boolean => !focusId || id === focusId || near.has(id);
  const radius = (id: string): number =>
    (variant === 'stars' ? 3 : 4) +
    Math.min(variant === 'stars' ? 4 : 7, Math.sqrt(deg.get(id) ?? 0) * 1.5);

  return (
    <svg
      ref={svgRef}
      className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      role="img"
      aria-label={`${clusters.length} folder clusters`}
      {...handlers}
    >
      <defs>
        <radialGradient id="cluster-bg" cx="50%" cy="50%" r="75%">
          <stop offset="0" stopColor="#111827" />
          <stop offset="1" stopColor="#05070d" />
        </radialGradient>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={variant === 'stars' ? '#1c1c1f' : 'url(#cluster-bg)'}
      />
      <g ref={gRef}>
        {variant === 'hulls' &&
          clusters.map((c) => {
            const col = colorOf(c.group);
            const pts = c.members.map((id) => pos.get(id)).filter((p): p is Pt => !!p);
            const top = Math.min(...pts.map((p) => p.y)) - 34;
            const label = `${c.group.split('/').pop() ?? c.group} · ${c.members.length}`;
            return (
              <g key={c.group}>
                <path
                  d={blobPath(pts, 26)}
                  fill={col}
                  fillOpacity={0.1}
                  stroke={col}
                  strokeOpacity={0.55}
                  strokeWidth={1.2}
                />
                <g transform={`translate(${c.cx},${top})`}>
                  <rect
                    x={-(label.length * 3.6 + 12)}
                    y={-11}
                    width={label.length * 7.2 + 24}
                    height={22}
                    rx={11}
                    fill="#0b0f19"
                    stroke={col}
                    strokeOpacity={0.8}
                  />
                  <text textAnchor="middle" dy={4} fontSize={11} fill="#e2e8f0">
                    {label}
                  </text>
                </g>
              </g>
            );
          })}
        {variant === 'stars' &&
          clusters.map((c) => (
            <g key={c.group}>
              {c.members.map((id) => {
                const p = pos.get(id);
                return p ? (
                  <line
                    key={id}
                    x1={c.cx}
                    y1={c.cy}
                    x2={p.x}
                    y2={p.y}
                    stroke="#64748b"
                    strokeOpacity={0.35}
                    strokeWidth={0.6}
                  />
                ) : null;
              })}
            </g>
          ))}
        {wires.map((l) => {
          const a = pos.get(l.source);
          const b = pos.get(l.target);
          if (!a || !b) return null;
          const on = focusId !== null && (l.source === focusId || l.target === focusId);
          return (
            <line
              key={`${l.source}>${l.target}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={on ? '#e0f2fe' : '#94a3b8'}
              strokeOpacity={on ? 0.9 : focusId ? 0.06 : 0.25}
              strokeWidth={on ? 1.3 : 0.7}
            />
          );
        })}
        {variant === 'stars' &&
          clusters.map((c) => (
            <g key={`hub-${c.group}`}>
              <circle cx={c.cx} cy={c.cy} r={6} fill={HUB}>
                <title>{c.group}</title>
              </circle>
              <text
                x={c.cx}
                y={c.cy - c.r * 0.9}
                textAnchor="middle"
                fontSize={11}
                fill="#cbd5e1"
                opacity={0.75}
              >
                {c.group.split('/').pop()}
              </text>
            </g>
          ))}
        {notes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const col = colorOf(n.group);
          const r = radius(n.id);
          const sel = n.id === selectedId;
          return (
            <g
              key={n.id}
              className="cursor-pointer"
              opacity={lit(n.id) ? 1 : 0.2}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(n.id);
              }}
            >
              <title>{n.title}</title>
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={col}
                stroke={sel ? '#ffffff' : variant === 'hulls' ? '#0b0f19' : 'none'}
                strokeWidth={sel ? 2 : 1}
              />
              {(n.id === focusId || near.has(n.id) || (deg.get(n.id) ?? 0) > 8) && (
                <text
                  x={p.x}
                  y={p.y + r + 11}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#e2e8f0"
                  className={clsx('pointer-events-none')}
                >
                  {n.title.slice(0, 32)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
