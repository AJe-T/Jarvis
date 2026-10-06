import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Tier } from '@shared/types';
import { defineTool, ok, type GuardInputs, type Tool } from '../tools/types';
import { createPolicyEngine, type PolicyDeps } from './policy-engine';

function tool(over: Partial<Tool<{ x?: string | undefined }>> = {}): Tool {
  return defineTool({
    name: 't',
    description: 'd',
    input: z.object({ x: z.string().optional() }),
    tier: 'SAFE',
    summarize: () => 'Do the thing',
    run: async () => ok('done'),
    ...over,
  });
}

function engine(over: Partial<PolicyDeps> = {}) {
  return createPolicyEngine({
    pathGuard: {
      check: (p: string) =>
        p.startsWith('C:\\ok') ? { ok: true, path: p } : { ok: false, reason: 'outside' },
    },
    budgetExceeded: () => false,
    overrides: () => ({}),
    ...over,
  });
}

const live = { signal: new AbortController().signal, tainted: false };

describe('policy engine', () => {
  it('uses a static tier', () => {
    expect(engine().evaluate(tool(), {}, live)).toMatchObject({
      tier: 'SAFE',
      humanSummary: 'Do the thing',
      destructive: false,
    });
    expect(engine().evaluate(tool({ tier: 'CONFIRM' }), {}, live).tier).toBe('CONFIRM');
  });

  it('uses a computed tier', () => {
    const t = tool({ tier: (i) => (i.x === 'exe' ? 'BLOCKED' : 'SAFE') });
    expect(engine().evaluate(t, { x: 'exe' }, live).tier).toBe('BLOCKED');
    expect(engine().evaluate(t, { x: 'txt' }, live).tier).toBe('SAFE');
  });

  it('computes destructive from input', () => {
    expect(
      engine().evaluate(tool({ destructive: () => true, tier: 'CONFIRM' }), {}, live).destructive,
    ).toBe(true);
    expect(
      engine().evaluate(tool({ destructive: true, tier: 'CONFIRM' }), {}, live).destructive,
    ).toBe(true);
  });

  it('blocks everything once the kill switch fired', () => {
    const c = new AbortController();
    c.abort();
    expect(engine().evaluate(tool(), {}, { signal: c.signal, tainted: false }).tier).toBe(
      'BLOCKED',
    );
  });

  it('blocks everything when the budget is exceeded', () => {
    expect(engine({ budgetExceeded: () => true }).evaluate(tool(), {}, live).tier).toBe('BLOCKED');
  });

  it.each<[string, GuardInputs, Tier]>([
    ['path outside roots', { paths: ['C:\\Windows\\x'] }, 'BLOCKED'],
    ['path inside roots', { paths: ['C:\\ok\\a.txt'] }, 'SAFE'],
    ['blocked script', { script: 'Set-MpPreference -DisableRealtimeMonitoring 1' }, 'BLOCKED'],
    ['benign script', { script: 'Get-Date' }, 'SAFE'],
    ['javascript: url', { urls: [{ url: 'javascript:alert(1)' }] }, 'BLOCKED'],
    ['private url when not allowed', { urls: [{ url: 'http://192.168.1.1/admin' }] }, 'BLOCKED'],
    [
      'private url when allowed',
      { urls: [{ url: 'http://localhost:3000', allowPrivate: true }] },
      'SAFE',
    ],
    ['https url', { urls: [{ url: 'https://github.com' }] }, 'SAFE'],
    ['card number in text', { text: ['pay with 4111 1111 1111 1111'] }, 'BLOCKED'],
    ['plain text', { text: ['hello world'] }, 'SAFE'],
  ])('global rule: %s', (_l, guards, expected) => {
    expect(engine().evaluate(tool({ guards: () => guards }), {}, live).tier).toBe(expected);
  });

  it('lets overrides only tighten', () => {
    const e = (o: Record<string, Tier>) => engine({ overrides: () => o });
    expect(e({ t: 'CONFIRM' }).evaluate(tool(), {}, live).tier).toBe('CONFIRM');
    expect(e({ t: 'BLOCKED' }).evaluate(tool(), {}, live).tier).toBe('BLOCKED');
    expect(e({ t: 'SAFE' }).evaluate(tool({ tier: 'CONFIRM' }), {}, live).tier).toBe('CONFIRM');
  });

  it('escalates external-facing SAFE tools to CONFIRM after untrusted content', () => {
    const d = engine().evaluate(tool({ externalFacing: true }), {}, { ...live, tainted: true });
    expect(d.tier).toBe('CONFIRM');
    expect(d.reason).toMatch(/external content/);
    expect(
      engine().evaluate(tool({ externalFacing: false }), {}, { ...live, tainted: true }).tier,
    ).toBe('SAFE');
    expect(engine().evaluate(tool({ externalFacing: true }), {}, live).tier).toBe('SAFE');
  });

  it('never fails on a throwing summarize()', () => {
    const t = tool({
      summarize: () => {
        throw new Error('x');
      },
    });
    expect(engine().evaluate(t, {}, live).humanSummary).toBe('t');
  });
});
