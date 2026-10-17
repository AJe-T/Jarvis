import { describe, expect, it } from 'vitest';
import { parsePrice } from '@main/llm/local-client';
import { sourceOf } from '@main/llm/usage-ledger';
import { setupServices } from './helpers';

const msg = (id: string, model: string, input = 1_000_000, output = 0) =>
  ({
    id,
    model,
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }) as never;

describe('usage per provider, connection and model (integrations step 5)', () => {
  it('reads gateway prices in their documented shapes (USD per token → per million)', () => {
    expect(
      parsePrice('openrouter', {
        prompt: '0.000003',
        completion: '0.000015',
        input_cache_read: '0.0000003',
      }),
    ).toEqual({ inPerMTok: 3, outPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3 });
    expect(parsePrice('vercel', { input: '0.000002', output: '0.000012' })).toMatchObject({
      inPerMTok: 2,
      outPerMTok: 12,
    });
    // Not a price: missing, negative, wrong unit or garbage.
    expect(parsePrice('vercel', { prompt: '0.1' })).toBeNull();
    expect(parsePrice('openrouter', { prompt: '-1', completion: '0' })).toBeNull();
    expect(parsePrice('openrouter', { prompt: '5', completion: '5' })).toBeNull(); // $5M per MTok
    expect(parsePrice('openrouter', 'free')).toBeNull();
  });

  it('tells who answered from the message id and billing', () => {
    expect(sourceOf('cloud_conn_openai_2_1792', 'api')).toBe('conn_openai_2');
    expect(sourceOf('cloud_conn_groq_17', 'api')).toBe('conn_groq');
    expect(sourceOf('local_12', 'api')).toBe('local');
    expect(sourceOf('msg_01', 'subscription')).toBe('claude-plan');
    expect(sourceOf('msg_01', 'api')).toBe('anthropic');
  });

  it('prices with Sir’s table first, then the gateway, else the dearest model; groups by connection', () => {
    const { services: s } = setupServices();
    s.connections.syncLive('conn_openrouter', [
      {
        id: 'meta/llama-4',
        price: { inPerMTok: 0.2, outPerMTok: 0.6, cacheReadPerMTok: 0.2, cacheWritePerMTok: 0.2 },
      },
    ]);
    const live = s.ledger.record(msg('cloud_conn_openrouter_1', 'meta/llama-4'), 'chat', null);
    expect(live.costUsd).toBeCloseTo(0.2);
    const unknown = s.ledger.record(msg('cloud_conn_openrouter_2', 'mystery-model'), 'chat', null);
    expect(unknown.costUsd).toBeGreaterThan(1); // dearest model: an over-estimate
    s.settings.set('pricing', {
      ...s.settings.get('pricing'),
      'meta/llama-4': {
        inPerMTok: 0.1,
        outPerMTok: 0.1,
        cacheReadPerMTok: 0,
        cacheWritePerMTok: 0,
      },
    });
    expect(
      s.ledger.record(msg('cloud_conn_openrouter_3', 'meta/llama-4'), 'chat', null).costUsd,
    ).toBeCloseTo(0.1);
    s.ledger.record(msg('local_4', 'qwen3:8b'), 'chat', null);

    const rows = s.usageRepo.breakdown('2000-01-01', '2999-12-31', 'source');
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['conn_openrouter']).toMatchObject({ calls: 3, estimated: 1 });
    expect(by['local']).toMatchObject({ calls: 1, costUsd: 0 });
    expect(
      s.usageRepo
        .breakdown('2000-01-01', '2999-12-31', 'billing')
        .map((r) => r.key)
        .sort(),
    ).toEqual(['api', 'local']);
  });
});
