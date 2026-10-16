import { describe, expect, it } from 'vitest';
import { buildBranches, placeTree, type TreeInput } from './model-tree';

const base: TreeInput = {
  provider: 'api',
  cloudProvider: 'openai',
  cloudModels: {},
  localModel: '',
  fallbackLocal: false,
  models: { default: 'sonnet', deep: 'opus', fast: 'haiku', computer: 'sonnet' },
  secrets: { anthropic: true },
  apps: [],
};

describe('model tree', () => {
  it('Claude with a key is the main brain with its four model roles as leaves', () => {
    const { on, off } = buildBranches(base);
    expect(on.map((b) => [b.id, b.role])).toEqual([['claude', 'main']]);
    expect(on[0]?.leaves.map((l) => l.model)).toEqual(['sonnet', 'opus', 'haiku', 'sonnet']);
    expect(off.map((b) => b.id)).toContain('openai');
  });

  it('a cloud provider with a key and a model is a helper; the chosen one is the main brain', () => {
    const helpers = buildBranches({
      ...base,
      cloudModels: { gemini: 'gemini-3-pro' },
      secrets: { anthropic: true, gemini: true },
    }).on;
    expect(helpers.map((b) => [b.id, b.role])).toEqual([
      ['claude', 'main'],
      ['gemini', 'helper'],
    ]);
    const main = buildBranches({
      ...base,
      provider: 'cloud',
      cloudProvider: 'gemini',
      secrets: { gemini: true },
    }).on;
    expect(main.map((b) => [b.id, b.role])).toEqual([['gemini', 'main']]);
  });

  it('a local fallback and signed-in plan apps hang off Jarvis too, main brain first', () => {
    const { on } = buildBranches({
      ...base,
      fallbackLocal: true,
      localModel: 'qwen3:8b',
      apps: [{ id: 'chatgpt', label: 'ChatGPT' }],
    });
    expect(on.map((b) => b.role)).toEqual(['main', 'fallback', 'helper']);
  });

  it('places each branch over the middle of its leaves', () => {
    const { on } = buildBranches(base);
    const { branches } = placeTree(on);
    const [claude] = branches;
    const xs = claude?.leaves.map((l) => l.x) ?? [];
    expect(claude?.at.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2);
  });
});
