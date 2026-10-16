import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Search, Trash2, X } from 'lucide-react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Switch } from '../../components/ui/field';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Markdown } from '../../components/jarvis/chat-message';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { blobPath, clusterLayout, colorOf, type GNode, type Pt } from '../brain/brain-layout';
import { usePanZoom } from '../brain/use-pan-zoom';
import { skillGroup } from './skill-groups';

type SkillView = Res<'skills:list'>[number];

const NO_DEGREES = new Map<string, number>();
/** Search matches up to this many get their names written next to the dot. */
const MAX_LABELS = 24;

/**
 * Every installed skill as a dot, clustered by group (a hull per group). Lit dots are switched on.
 * Search dims what doesn't match; clicking a dot opens it in the side panel to read, switch or remove.
 */
export function SkillsNetwork({
  skills,
  reload,
  focus = null,
}: {
  skills: SkillView[];
  reload(): void;
  /** Select this skill when it changes (a skill just installed). */
  focus?: string | null;
}): React.JSX.Element {
  const toast = useUiStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);

  // Keyed on names and descriptions only: switching a skill on must not re-lay the map (and reset the zoom).
  const layoutKey = JSON.stringify(skills.map((s) => [s.name, s.description]));
  const nodes = useMemo<GNode[]>(
    () =>
      (JSON.parse(layoutKey) as Array<[string, string]>).map(([name, description]) => ({
        id: name,
        title: name,
        group: skillGroup(name, description),
        size: 1,
      })),
    [layoutKey],
  );
  const groups = useMemo(() => {
    const count = new Map<string, { total: number; on: number }>();
    for (const n of nodes) {
      const c = count.get(n.group) ?? { total: 0, on: 0 };
      const on = skills.find((s) => s.name === n.id)?.enabled ? 1 : 0;
      count.set(n.group, { total: c.total + 1, on: c.on + on });
    }
    return [...count.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [nodes, skills]);
  const visible = useMemo(() => nodes.filter((n) => !hidden.has(n.group)), [nodes, hidden]);
  const { pos, clusters } = useMemo(() => clusterLayout(visible, NO_DEGREES, 18), [visible]);
  const byName = useMemo(() => new Map(skills.map((s) => [s.name, s])), [skills]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? new Set(
            skills
              .filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q))
              .map((s) => s.name),
          )
        : null,
    [q, skills],
  );

  const bounds = useCallback(() => {
    if (!clusters.length) return null;
    return {
      x0: Math.min(...clusters.map((c) => c.cx - c.r)) - 20,
      y0: Math.min(...clusters.map((c) => c.cy - c.r)) - 40,
      x1: Math.max(...clusters.map((c) => c.cx + c.r)) + 20,
      y1: Math.max(...clusters.map((c) => c.cy + c.r)) + 20,
    };
  }, [clusters]);
  const { svgRef, gRef, fit, center, handlers } = usePanZoom(bounds, 3);
  useEffect(() => fit(), [fit]);

  const select = (name: string | null): void => {
    setSelected(name);
    setMarkdown(null);
    const p = name ? pos.get(name) : undefined;
    if (p) center(p.x, p.y, 1.6);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new skill is handed in
  useEffect(() => (focus ? select(focus) : undefined), [focus]);

  const current = selected ? byName.get(selected) : undefined;
  const focusId = hover ?? selected;

  return (
    <div className="flex min-h-[38rem] flex-col gap-3 lg:flex-row">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-[#05070d]">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
          <label className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 focus-within:border-cyan-400/60">
            <Search size={14} aria-hidden className="text-slate-400" />
            <input
              type="search"
              aria-label="Search skills"
              placeholder={`Search ${skills.length} skills…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                const first = matches && [...matches].find((m) => pos.has(m));
                if (e.key === 'Enter' && first) select(first);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
            {matches && <span className="text-xs text-slate-400">{matches.size} found</span>}
          </label>
          <button
            type="button"
            onClick={fit}
            className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:border-cyan-400/60 hover:text-white"
          >
            Fit
          </button>
        </div>
        <ul aria-label="Skill groups" className="flex flex-wrap gap-1.5 px-2 pt-2">
          {groups.map(([g, c]) => {
            const off = hidden.has(g);
            return (
              <li key={g}>
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (off) next.delete(g);
                      else next.add(g);
                      return next;
                    })
                  }
                  className={clsx(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-opacity',
                    off
                      ? 'border-white/10 text-slate-500 opacity-60'
                      : 'border-white/20 text-slate-200',
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{
                      background: off ? 'transparent' : colorOf(g),
                      border: `1px solid ${colorOf(g)}`,
                    }}
                  />
                  {g}
                  <span className="text-slate-500">
                    {c.on}/{c.total}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <svg
          ref={svgRef}
          className="block min-h-[30rem] w-full flex-1 cursor-grab touch-none select-none active:cursor-grabbing"
          role="img"
          aria-label={`${skills.length} skills in ${clusters.length} groups`}
          {...handlers}
        >
          <g ref={gRef}>
            {clusters.map((c) => {
              const col = colorOf(c.group);
              const pts = c.members.map((id) => pos.get(id)).filter((p): p is Pt => !!p);
              const top = Math.min(...pts.map((p) => p.y)) - 36;
              const label = `${c.group} · ${c.members.length}`;
              return (
                <g key={c.group}>
                  <path
                    d={blobPath(pts, 24)}
                    fill={col}
                    fillOpacity={0.07}
                    stroke={col}
                    strokeOpacity={0.45}
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
            {visible.map((n) => {
              const p = pos.get(n.id);
              const s = byName.get(n.id);
              if (!p || !s) return null;
              const col = colorOf(n.group);
              const sel = n.id === selected;
              const dim = matches ? !matches.has(n.id) : false;
              const named =
                n.id === focusId || (matches !== null && !dim && matches.size <= MAX_LABELS);
              return (
                <g
                  key={n.id}
                  className="cursor-pointer"
                  opacity={dim ? 0.12 : 1}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    select(n.id);
                  }}
                >
                  <title>{`${s.name}${s.enabled ? ' (on)' : ''}`}</title>
                  {s.enabled && <circle cx={p.x} cy={p.y} r={11} fill={col} opacity={0.18} />}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={sel ? 8 : 6}
                    fill={s.enabled ? col : '#0b0f19'}
                    stroke={sel ? '#ffffff' : col}
                    strokeOpacity={s.enabled || sel ? 1 : 0.55}
                    strokeWidth={sel ? 2 : 1.2}
                  />
                  {named && (
                    <text
                      x={p.x}
                      y={p.y + 17}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#e2e8f0"
                      className="pointer-events-none"
                    >
                      {s.name.slice(0, 32)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <p className="pointer-events-none absolute right-3 bottom-2 text-[11px] text-slate-500">
          ● on · ○ off · scroll to zoom, drag to pan
        </p>
      </div>
      <aside
        aria-label="Skill details"
        className="flex w-full shrink-0 flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4 lg:w-80"
      >
        {current ? (
          <>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-words text-ink-100">{current.name}</p>
                <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-500">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: colorOf(skillGroup(current.name, current.description)) }}
                  />
                  {skillGroup(current.name, current.description)}
                </span>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-1 text-ink-500 hover:bg-hover hover:text-ink-100"
                onClick={() => select(null)}
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            <p className="text-sm text-ink-300">{current.description}</p>
            <p className="text-xs text-ink-500">
              {current.files.length} extra file(s){current.license ? ` · ${current.license}` : ''}
            </p>
            <Switch
              label="Use this skill"
              checked={current.enabled}
              onChange={(on) =>
                void call('skills:setEnabled', { name: current.name, enabled: on })
                  .then(reload)
                  .catch((err: unknown) => toast({ level: 'error', message: cleanError(err) }))
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  markdown !== null
                    ? setMarkdown(null)
                    : void call('skills:read', { name: current.name }).then((r) =>
                        setMarkdown(r.markdown),
                      )
                }
              >
                {markdown !== null ? 'Hide instructions' : 'Read instructions'}
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  void confirmAction({
                    title: `Remove the skill "${current.name}"?`,
                    body: 'Its folder is deleted from Jarvis. You can install it again later.',
                    actionLabel: 'Remove',
                    destructive: true,
                  }).then(async (yes) => {
                    if (!yes) return;
                    await call('skills:remove', { name: current.name });
                    select(null);
                    reload();
                  })
                }
              >
                <Trash2 size={14} aria-hidden /> Remove
              </Button>
            </div>
            {markdown !== null && (
              <div className="prose-sm max-h-80 overflow-y-auto rounded-md border border-line bg-surface-2 p-3 text-sm text-ink-300">
                <Markdown text={markdown} />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 text-sm text-ink-500">
            <p className="font-semibold text-ink-100">
              {skills.filter((s) => s.enabled).length} of {skills.length} skills on
            </p>
            <p>
              Each dot is a skill, grouped by what it helps with. Lit dots are on. Click a dot to
              read it and switch it on or off; click a group below the search to hide it.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
