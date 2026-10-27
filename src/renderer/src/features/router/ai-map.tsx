import { useEffect, useState } from 'react';
import type { PoolSnapshot } from '@shared/free-pool';
import type { Res } from '@shared/ipc-contract';
import { call } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { buildMap, layoutMap, type MapNode, type Placed, type RouterTab } from './ai-map-model';

/** Curved wire from a parent's right edge to a child's left edge. */
const wire = (a: Placed, b: Placed): string => {
  const x1 = a.x + a.w;
  const x2 = b.x;
  const mx = (x1 + x2) / 2;
  return `M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`;
};

const fit = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Every AI Jarvis can use, as a left-to-right map drawn at full size (it scrolls instead of
 * shrinking). Click a node to open the AI Router tab that changes it.
 */
export function AiMap({
  snap,
  onOpen,
}: {
  /** The pool's live state when the caller has it (AI Router); fetched otherwise. */
  snap?: PoolSnapshot | null;
  onOpen: (tab: RouterTab) => void;
}): React.JSX.Element {
  const values = useSettingsStore((s) => s.values);
  const [connections, setConnections] = useState<Res<'ai:connections'>>([]);
  const [apps, setApps] = useState<Res<'llm:cliStatus'>>([]);
  const [anthropicKey, setAnthropicKey] = useState(false);
  const [pool, setPool] = useState<PoolSnapshot | null>(snap ?? null);

  // Keys, sign-ins and the pool change outside the settings draft: re-read on every save.
  useEffect(() => {
    void call('ai:connections', {})
      .then(setConnections)
      .catch(() => setConnections([]));
    void call('llm:cliStatus', {})
      .then(setApps)
      .catch(() => setApps([]));
    void call('secrets:status', {})
      .then((s) => setAnthropicKey(Boolean(s['anthropic']?.set)))
      .catch(() => undefined);
    if (snap === undefined)
      void call('pool:snapshot', {})
        .then(setPool)
        .catch(() => setPool(null));
  }, [values, snap]);
  useEffect(() => {
    if (snap) setPool(snap);
  }, [snap]);

  const { root, offline } = buildMap({
    provider: useDraftSetting('llm.provider') ?? 'api',
    cloudProvider: useDraftSetting('llm.cloud.provider') ?? 'openai',
    cloudConnection: useDraftSetting('llm.cloud.connection') ?? '',
    models: {
      default: useDraftSetting('models.default') ?? '',
      deep: useDraftSetting('models.deep') ?? '',
      fast: useDraftSetting('models.fast') ?? '',
      computer: useDraftSetting('models.computer') ?? '',
    },
    localModel: useDraftSetting('llm.local.model') ?? '',
    fallbackLocal: useDraftSetting('llm.fallbackLocal') === true,
    anthropicKey,
    connections,
    pool,
    apps: apps.filter((a) => a.installed && a.signedIn).map((a) => ({ id: a.id, label: a.label })),
  });
  const layout = layoutMap(root);
  const summary = root.children
    .map((g) => `${g.label}: ${g.children.map((c) => c.label).join(', ') || 'none'}`)
    .join('; ');

  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-[75vh] overflow-auto rounded-lg border border-line bg-surface-1">
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`Jarvis's AI map. ${summary}`}
          className="block"
        >
          {layout.edges.map((e) => (
            <path
              key={`${e.from.node.id}>${e.to.node.id}`}
              d={wire(e.from, e.to)}
              fill="none"
              stroke={e.to.node.color}
              strokeWidth={e.from.node.kind === 'root' ? 2 : 1.4}
              strokeOpacity={e.to.node.muted ? 0.25 : 0.6}
              strokeDasharray={e.to.node.muted ? '3 4' : undefined}
            />
          ))}
          {layout.nodes.map((p) => (
            <Node key={p.node.id} p={p} onOpen={onOpen} />
          ))}
        </svg>
      </div>
      {offline.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-500">No key yet:</span>
          {offline.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpen('keys')}
              className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-ink-300 hover:border-ink-500 hover:text-ink-100"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Node({ p, onOpen }: { p: Placed; onOpen: (tab: RouterTab) => void }): React.JSX.Element {
  const n: MapNode = p.node;
  const open = n.tab ? (): void => onOpen(n.tab as RouterTab) : undefined;
  const fade = n.muted ? 0.45 : 1;
  const interactive = open
    ? {
        role: 'button',
        tabIndex: 0,
        className: 'cursor-pointer focus:outline-none [&:focus-visible>rect]:stroke-[3]',
        'aria-label': `${n.label}${n.sub ? `, ${n.sub}` : ''}: open its tab`,
        onClick: open,
        onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && open(),
      }
    : {};
  if (n.kind === 'root')
    return (
      <g transform={`translate(${p.x},${p.y})`}>
        <rect x={0} y={-22} width={p.w} height={44} rx={22} fill="var(--accent-glow)" />
        <rect
          x={4}
          y={-18}
          width={p.w - 8}
          height={36}
          rx={18}
          fill="var(--surface-2)"
          stroke="var(--accent-600)"
          strokeWidth={2}
        />
        <text
          x={p.w / 2}
          y={5}
          textAnchor="middle"
          fontSize={13}
          fontWeight={700}
          fill="var(--ink-100)"
        >
          JARVIS
        </text>
      </g>
    );
  const leaf = n.kind === 'leaf';
  const h = n.sub ? 30 : 24;
  const maxChars = Math.floor((p.w - 20) / (leaf ? 6.6 : 7.2));
  return (
    <g transform={`translate(${p.x},${p.y})`} opacity={fade} {...interactive}>
      {n.sub && <title>{`${n.label}: ${n.sub}`}</title>}
      <rect
        x={0}
        y={-h / 2}
        width={p.w}
        height={h}
        rx={leaf ? 7 : h / 2}
        fill={leaf ? 'var(--surface-1)' : 'var(--surface-2)'}
        stroke={n.color}
        strokeWidth={n.kind === 'group' ? 2 : 1.3}
        strokeOpacity={leaf ? 0.55 : 1}
      />
      {!leaf && <circle cx={14} cy={0} r={4.5} fill={n.color} />}
      <text
        x={leaf ? 10 : 26}
        y={n.sub ? -2 : 4}
        fontSize={leaf ? 11.5 : 12.5}
        fontWeight={leaf ? 500 : 650}
        fill="var(--ink-100)"
      >
        {fit(n.label, maxChars)}
      </text>
      {n.sub && (
        <text
          x={leaf ? 10 : 26}
          y={11}
          fontSize={10}
          fontFamily={leaf ? 'var(--font-code, monospace)' : undefined}
          fill={leaf ? 'var(--ink-300)' : n.color}
        >
          {fit(n.sub, maxChars + 4)}
        </text>
      )}
    </g>
  );
}
