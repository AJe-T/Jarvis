import { describe, expect, it } from 'vitest';
import { fusionLine, judgeOrder, pickLineup } from './fusion';
import type { RouteState } from './router';

const route = (provider: string, model: string, order = 0): RouteState => ({
  key: `${provider}|${model}`,
  connectionId: `conn_${provider}`,
  provider,
  model,
  tier: 2,
  enabled: true,
  order,
  limits: {},
  used: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 },
  stats: { ok: 0, fail: 0, avgMs: 0, tokPerSec: 0 },
  tools: null,
  vision: null,
  lastUsed: 0,
});

describe('fusion line-up', () => {
  it('takes one drafter per provider, at most three, in ranked order', () => {
    const ranked = [
      route('groq', 'llama-3.3-70b-versatile'),
      route('groq', 'llama-3.1-8b-instant'),
      route('cerebras', 'gpt-oss-120b'),
      route('gemini', 'gemini-2.5-flash'),
      route('mistral', 'mistral-large-latest'),
    ];
    const { drafters } = pickLineup(ranked);
    expect(drafters.map((d) => d.key)).toEqual([
      'groq|llama-3.3-70b-versatile',
      'cerebras|gpt-oss-120b',
      'gemini|gemini-2.5-flash',
    ]);
  });

  it('the judge is the largest model, from a provider that did not draft when one is free', () => {
    const ranked = [
      route('groq', 'llama-3.1-8b-instant'),
      route('cerebras', 'gpt-oss-120b'),
      route('mistral', 'mistral-large-latest'),
      route('nvidia', 'deepseek-v3.1-671b'),
    ];
    // 671B is "frontier": it wins even though nvidia drafted nothing else.
    expect(judgeOrder(ranked, ['groq', 'cerebras'])[0]?.provider).toBe('nvidia');
    // Same size: the provider that did not draft goes first.
    const same = [route('groq', 'gpt-oss-120b'), route('cerebras', 'gpt-oss-120b')];
    expect(judgeOrder(same, ['groq'])[0]?.provider).toBe('cerebras');
  });

  it('the trail names every drafter, the judge and what failed', () => {
    const ok = (name: string, model: string) => ({
      provider: name.toLowerCase(),
      name,
      model,
      tier: 2 as const,
      ok: true,
    });
    const line = fusionLine({
      drafts: [
        { attempts: [ok('Groq', 'llama-3.3-70b')] },
        {
          attempts: [
            { ...ok('Cerebras', 'gpt-oss-120b'), ok: false, reason: 'rate limited' },
            ok('Cerebras', 'qwen-3-32b'),
          ],
        },
      ],
      judge: { attempts: [ok('Gemini', 'gemini-2.5-pro')] },
    });
    expect(line).toBe(
      '(Fusion: drafts by Groq · llama-3.3-70b, Cerebras · qwen-3-32b; judged by Gemini · gemini-2.5-pro; tried Cerebras: rate limited.)',
    );
  });
});
