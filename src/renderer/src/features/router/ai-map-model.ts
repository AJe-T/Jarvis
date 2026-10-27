import { freeProvider, type PoolSnapshot } from '@shared/free-pool';
import { CLOUD_PROVIDERS, cloudProvider, type CloudProviderId } from '@shared/llm-providers';
import { PROVIDER_COLORS } from './colors';

/**
 * The AI map (AI Router → Overview, Settings → Models & AI): Jarvis, the groups of AIs he can
 * use, each provider and the models it runs. Built from settings, keys and the pool snapshot
 * only (no network), then laid out left to right so a long list of models stays readable.
 */

export type RouterTab =
  'overview' | 'brain' | 'keys' | 'models' | 'tiers' | 'delegation' | 'abilities' | 'analytics';

export interface MapNode {
  id: string;
  label: string;
  /** Second line (a model id, a role, a count). */
  sub?: string;
  color: string;
  kind: 'root' | 'group' | 'provider' | 'leaf';
  /** The AI Router tab that changes this node. */
  tab?: RouterTab;
  /** Drawn faded: set up but not working (no key, switched off). */
  muted?: boolean;
  children: MapNode[];
}

export interface MapInput {
  provider: 'api' | 'subscription' | 'local' | 'cloud';
  cloudProvider: CloudProviderId;
  cloudConnection: string;
  models: { default: string; deep: string; fast: string; computer: string };
  localModel: string;
  fallbackLocal: boolean;
  anthropicKey: boolean;
  connections: Array<{
    id: string;
    provider: CloudProviderId;
    label: string;
    keySet: boolean;
    model: string;
    primary: boolean;
  }>;
  pool: Pick<PoolSnapshot, 'enabled' | 'models' | 'providers' | 'abilities'> | null;
  apps: Array<{ id: string; label: string }>;
}

/** Most models drawn under one provider; the rest are one "+N more" leaf. */
export const MAX_LEAVES = 6;
const ACCENT = 'var(--accent-500)';
const colorOf = (id: string): string => PROVIDER_COLORS[id] ?? '#94a3b8';
const short = (label: string): string => label.replace(/\s*\(.*\)$/, '');

function capped(leaves: MapNode[], idPrefix: string, color: string, tab: RouterTab): MapNode[] {
  if (leaves.length <= MAX_LEAVES) return leaves;
  return [
    ...leaves.slice(0, MAX_LEAVES - 1),
    {
      id: `${idPrefix}-more`,
      label: `+${leaves.length - MAX_LEAVES + 1} more models`,
      color,
      kind: 'leaf',
      tab,
      children: [],
    },
  ];
}

const leaf = (id: string, label: string, sub: string, color: string, tab: RouterTab): MapNode => ({
  id,
  label,
  sub,
  color,
  kind: 'leaf',
  tab,
  children: [],
});

function mainBrain(t: MapInput): MapNode {
  const claude = t.provider === 'api' || t.provider === 'subscription';
  const brains: MapNode[] = [];
  if (claude) {
    const c = colorOf('claude');
    brains.push({
      id: 'claude',
      label: t.provider === 'subscription' ? 'Claude (your plan)' : 'Claude (API key)',
      color: c,
      kind: 'provider',
      tab: 'brain',
      ...(t.provider === 'api' && !t.anthropicKey ? { muted: true, sub: 'no key yet' } : {}),
      children: [
        leaf('m-default', 'Conversation', t.models.default, c, 'brain'),
        leaf('m-deep', 'Deep thinking', t.models.deep, c, 'brain'),
        leaf('m-fast', 'Background jobs', t.models.fast, c, 'brain'),
        leaf('m-computer', 'Computer control', t.models.computer, c, 'brain'),
      ],
    });
  }
  if (t.provider === 'cloud') {
    const conn =
      t.connections.find((c) => c.id === t.cloudConnection) ??
      t.connections.find((c) => c.provider === t.cloudProvider && c.primary);
    const c = colorOf(t.cloudProvider);
    brains.push({
      id: 'cloud-main',
      label: short(cloudProvider(t.cloudProvider).label),
      color: c,
      kind: 'provider',
      tab: 'brain',
      ...(conn?.keySet ? {} : { muted: true, sub: 'no key yet' }),
      children: [leaf('m-cloud', 'Conversation', conn?.model || 'no model chosen', c, 'brain')],
    });
  }
  const local = t.provider === 'local' || (t.provider === 'api' && t.fallbackLocal);
  if (local) {
    const c = colorOf('local');
    brains.push({
      id: 'local',
      label: t.provider === 'local' ? 'Local model' : 'Local model (fallback)',
      color: c,
      kind: 'provider',
      tab: 'brain',
      ...(t.localModel ? {} : { muted: true }),
      children: [
        leaf(
          'm-local',
          t.provider === 'local' ? 'Conversation' : 'When Claude is down',
          t.localModel || 'no model chosen',
          c,
          'brain',
        ),
      ],
    });
  }
  return {
    id: 'g-brain',
    label: 'Main brain',
    sub: 'answers you',
    color: ACCENT,
    kind: 'group',
    tab: 'brain',
    children: brains,
  };
}

function freePool(t: MapInput): MapNode | null {
  if (!t.pool) return null;
  const byProvider = new Map<string, string[]>();
  for (const m of t.pool.models)
    for (const r of m.routes)
      byProvider.set(r.providerId, [...new Set([...(byProvider.get(r.providerId) ?? []), m.id])]);
  const providers = [...byProvider.entries()].map(([id, models]): MapNode => {
    const p = t.pool?.providers.find((x) => x.id === id);
    const c = colorOf(id);
    const keys = p?.keys.length ?? 0;
    return {
      id: `pool-${id}`,
      label: p?.label ?? id,
      sub: `tier ${p?.tier ?? 2} · ${keys} key${keys === 1 ? '' : 's'}`,
      color: c,
      kind: 'provider',
      tab: 'keys',
      ...(p && !p.enabled ? { muted: true } : {}),
      children: capped(
        models.map((m) => leaf(`pool-${id}-${m}`, m, '', c, 'models')),
        `pool-${id}`,
        c,
        'models',
      ),
    };
  });
  return {
    id: 'g-pool',
    label: 'Free AI pool',
    sub: t.pool.enabled ? `${t.pool.models.length} models` : 'switched off',
    color: 'var(--ok-400)',
    kind: 'group',
    tab: 'models',
    ...(t.pool.enabled ? {} : { muted: true }),
    children: providers,
  };
}

/** Paid providers with a key and a model: Claude can hand them sub-tasks (delegate_task). */
function helpers(t: MapInput): MapNode | null {
  const used = t.connections.filter(
    (c) =>
      c.keySet &&
      c.model &&
      !freeProvider(c.provider) &&
      !(
        t.provider === 'cloud' &&
        (c.id === t.cloudConnection || (c.primary && c.provider === t.cloudProvider))
      ),
  );
  const providers = [...new Set(used.map((c) => c.provider))].map((p): MapNode => {
    const c = colorOf(p);
    return {
      id: `help-${p}`,
      label: short(cloudProvider(p).label),
      sub: 'paid, per use',
      color: c,
      kind: 'provider',
      tab: 'keys',
      children: used
        .filter((x) => x.provider === p)
        .map((x) =>
          leaf(`help-${x.id}`, x.primary ? 'Sub-tasks' : short(x.label), x.model, c, 'keys'),
        ),
    };
  });
  for (const a of t.apps)
    providers.push({
      id: `app-${a.id}`,
      label: a.label,
      sub: 'your plan',
      color: colorOf(a.id),
      kind: 'provider',
      tab: 'brain',
      children: [],
    });
  return providers.length
    ? {
        id: 'g-help',
        label: 'Helpers',
        sub: 'take sub-tasks',
        color: '#a78bfa',
        kind: 'group',
        tab: 'brain',
        children: providers,
      }
    : null;
}

function abilities(t: MapInput): MapNode | null {
  const a = t.pool?.abilities;
  if (!a) return null;
  const c = 'var(--lamp-400)';
  const search = a.search.filter((s) => s.keySet).map((s) => s.name);
  const images = a.image.filter((m) => m.ready).map((m) => m.name);
  const kids: MapNode[] = [
    leaf(
      'ab-search',
      'Free web search',
      a.settings.search ? search.join(', ') || 'no key yet' : 'off',
      c,
      'abilities',
    ),
    leaf(
      'ab-image',
      'Pictures',
      a.settings.image ? images.join(', ') || 'not set up' : 'off',
      c,
      'abilities',
    ),
    leaf(
      'ab-fusion',
      'Fusion brain',
      a.settings.fusion
        ? a.fusion.drafters.length
          ? `${a.fusion.drafters.length} drafters + judge`
          : 'needs 2 providers'
        : 'off',
      c,
      'abilities',
    ),
    leaf(
      'ab-voice',
      'Voice backup',
      `speaking ${a.settings.voiceSpeaking ? 'on' : 'off'} · cloud hearing ${a.settings.voiceHearing ? 'on' : 'off'}`,
      c,
      'abilities',
    ),
  ];
  return {
    id: 'g-abilities',
    label: 'Abilities',
    sub: 'free extras',
    color: c,
    kind: 'group',
    tab: 'abilities',
    children: kids,
  };
}

export function buildMap(t: MapInput): {
  root: MapNode;
  offline: Array<{ id: string; label: string }>;
} {
  const groups = [mainBrain(t), freePool(t), helpers(t), abilities(t)].filter(
    (g): g is MapNode => g !== null && (g.children.length > 0 || g.id === 'g-brain'),
  );
  const keyed = new Set(t.connections.filter((c) => c.keySet).map((c) => c.provider));
  return {
    root: { id: 'root', label: 'JARVIS', color: ACCENT, kind: 'root', children: groups },
    offline: CLOUD_PROVIDERS.filter((p) => !keyed.has(p.id)).map((p) => ({
      id: p.id,
      label: short(p.label),
    })),
  };
}

// ── Layout: left to right, one row per leaf, a parent centred on its children ───────────────

export const ROW = 34;
export const COLUMNS = [16, 136, 330, 556] as const;
export const WIDTHS = { root: 100, group: 168, provider: 196, leaf: 300 } as const;

export interface Placed {
  node: MapNode;
  x: number;
  y: number;
  w: number;
}

export function layoutMap(root: MapNode): {
  width: number;
  height: number;
  nodes: Placed[];
  edges: Array<{ from: Placed; to: Placed }>;
} {
  const nodes: Placed[] = [];
  const edges: Array<{ from: Placed; to: Placed }> = [];
  let row = 0;
  const place = (n: MapNode, depth: number): Placed => {
    const x = COLUMNS[Math.min(depth, COLUMNS.length - 1)] ?? 0;
    const w = WIDTHS[n.kind];
    if (n.children.length === 0) {
      const p = { node: n, x, y: 24 + row * ROW, w };
      row += 1;
      nodes.push(p);
      return p;
    }
    const kids = n.children.map((c) => place(c, depth + 1));
    const first = kids[0] as Placed;
    const last = kids[kids.length - 1] as Placed;
    const p = { node: n, x, y: (first.y + last.y) / 2, w };
    nodes.push(p);
    for (const k of kids) edges.push({ from: p, to: k });
    // A little air between groups.
    if (depth === 1) row += 0.5;
    return p;
  };
  place(root, 0);
  const width = Math.max(...nodes.map((p) => p.x + p.w)) + 16;
  const height = Math.max(...nodes.map((p) => p.y)) + 30;
  return { width, height, nodes, edges };
}
