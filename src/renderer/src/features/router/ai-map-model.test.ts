import { describe, expect, it } from 'vitest';
import { previewSnapshot } from './preview';
import { buildMap, layoutMap, MAX_LEAVES, type MapInput, type MapNode } from './ai-map-model';

const snap = previewSnapshot(0);

const base: MapInput = {
  provider: 'api',
  cloudProvider: 'openai',
  cloudConnection: '',
  models: {
    default: 'claude-sonnet-5-5',
    deep: 'claude-opus-5-5',
    fast: 'claude-haiku-5-5',
    computer: 'claude-sonnet-5-5',
  },
  localModel: '',
  fallbackLocal: false,
  anthropicKey: true,
  // Sir's case: keys on extra connections (conn_groq_2), no model chosen.
  connections: [
    {
      id: 'conn_groq_2',
      provider: 'groq',
      label: 'Groq (2)',
      keySet: true,
      model: '',
      primary: false,
    },
    {
      id: 'conn_openrouter_2',
      provider: 'openrouter',
      label: 'OpenRouter (2)',
      keySet: true,
      model: '',
      primary: false,
    },
    {
      id: 'conn_deepseek',
      provider: 'deepseek',
      label: 'DeepSeek',
      keySet: true,
      model: 'deepseek-chat',
      primary: true,
    },
  ],
  pool: snap,
  apps: [{ id: 'chatgpt', label: 'ChatGPT plan' }],
};

const group = (root: MapNode, id: string): MapNode | undefined =>
  root.children.find((g) => g.id === id);

describe('AI map', () => {
  it('shows the main brain, every free-pool provider with its models, paid helpers and abilities', () => {
    const { root, offline } = buildMap(base);
    expect(root.children.map((g) => g.label)).toEqual([
      'Main brain',
      'Free AI pool',
      'Helpers',
      'Abilities',
    ]);
    expect(group(root, 'g-brain')?.children[0]?.children.map((l) => l.sub)).toEqual([
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
    ]);
    const pool = group(root, 'g-pool');
    const providers = new Set(snap.models.flatMap((m) => m.routes.map((r) => r.providerId)));
    expect(pool?.children).toHaveLength(providers.size);
    for (const p of pool?.children ?? []) expect(p.children.length).toBeLessThanOrEqual(MAX_LEAVES);
    expect(group(root, 'g-help')?.children.map((p) => p.label)).toEqual([
      'DeepSeek',
      'ChatGPT plan',
    ]);
    // Providers with a key are not in the "no key yet" strip.
    expect(offline.map((o) => o.id)).not.toContain('groq');
    expect(offline.map((o) => o.id)).toContain('openai');
  });

  it('a missing Anthropic key fades Claude; a switched-off pool says so', () => {
    const { root } = buildMap({
      ...base,
      anthropicKey: false,
      pool: { ...snap, enabled: false },
    });
    expect(group(root, 'g-brain')?.children[0]).toMatchObject({ muted: true, sub: 'no key yet' });
    expect(group(root, 'g-pool')).toMatchObject({ muted: true, sub: 'switched off' });
  });

  it('lays out one row per leaf, left to right, with nothing overlapping', () => {
    const { nodes, width, height } = layoutMap(buildMap(base).root);
    const leaves = nodes.filter((n) => n.node.children.length === 0);
    const ys = leaves.map((n) => n.y);
    expect(new Set(ys).size).toBe(ys.length);
    for (const n of nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(width);
      expect(n.y).toBeLessThan(height);
    }
    // Each parent sits to the left of its children.
    const root = nodes.find((n) => n.node.kind === 'root');
    expect(nodes.every((n) => n === root || n.x > (root?.x ?? 0))).toBe(true);
  });
});
