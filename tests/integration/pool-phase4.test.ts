import { describe, expect, it } from 'vitest';
import { TOOL_STUB } from '@main/llm/pool/shrink';
import type { LlmRequest } from '@main/llm/types';
import { CEREBRAS, GROQ, rateLimited, setup, sse } from './pool-fakes';

/** AI Router Phase 4: strategies, named chains, shrinking, context sizes, tests and analytics. */

const signal = (): AbortSignal => new AbortController().signal;
const ask = (t: ReturnType<typeof setup>, req: Partial<LlmRequest> = {}, chain?: string) =>
  t.services.pool
    .session({ id: `j${Math.random()}`, task: 't', ...(chain ? { chain } : {}) })
    .stream(
      { model: 'pool', max_tokens: 100, messages: [{ role: 'user', content: 'Hi' }], ...req },
      {
        signal: signal(),
      },
    );

describe('AI Router Phase 4', () => {
  it('a named chain sends its model first, whatever the strategy says', async () => {
    const t = setup(() => sse('ok'));
    const s = t.services;
    // Priority order: Groq first. The "Coding" chain puts Cerebras's model first.
    s.settings.set('pool.chains', [{ name: 'Coding', models: ['gpt-oss-120b'] }]);
    await ask(t, {}, 'coding');
    expect(t.calls).toEqual([CEREBRAS]);
    await ask(t);
    expect(t.calls).toEqual([CEREBRAS, GROQ]);
    // An unknown chain changes nothing.
    await ask(t, {}, 'Vision');
    expect(t.calls.at(-1)).toBe(GROQ);
  });

  it('every strategy runs (no fallback to Balanced)', async () => {
    const t = setup(() => sse('ok'));
    const s = t.services;
    for (const strategy of ['smartest', 'fastest', 'reliable', 'custom'] as const) {
      s.settings.set('pool.strategy', strategy);
      await ask(t);
    }
    expect(t.calls).toHaveLength(4);
    expect(s.pool.snapshot().strategy).toBe('custom');
  });

  it('older tool output is trimmed before a free model gets it (shrink on), sent whole when off', async () => {
    const t = setup(() => sse('ok'));
    const page = 'Long page text. '.repeat(400);
    const messages: LlmRequest['messages'] = [
      { role: 'user', content: 'Read two pages.' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'fetch_web_page', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: page }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Read the first.' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't2', name: 'fetch_web_page', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't2', content: 'second page' }],
      },
      { role: 'user', content: 'Summarise both.' },
    ];
    await ask(t, { messages });
    const sent = JSON.stringify(t.bodies.at(-1));
    expect(sent).toContain(TOOL_STUB);
    expect(sent).not.toContain('Long page text. Long page text.');
    t.services.settings.set('pool.shrink', false);
    await ask(t, { messages });
    expect(JSON.stringify(t.bodies.at(-1))).toContain('Long page text. Long page text.');
  });

  it('Test this model asks each tier-2 door once and reports how it went', async () => {
    const t = setup((url) => (url === GROQ ? rateLimited() : sse('OK')));
    const out = await t.services.pool.testModel('gpt-oss-120b');
    expect(out).toEqual([
      expect.objectContaining({ provider: 'cerebras', name: 'Cerebras', ok: true }),
    ]);
    const bad = await t.services.pool.testModel('llama-3.3-70b-versatile');
    expect(bad[0]).toMatchObject({ ok: false, reason: 'rate limited' });
  });

  it('analytics counts what happened, per provider and model', async () => {
    const t = setup((url) => (url === GROQ ? rateLimited() : sse('ok')));
    await ask(t);
    const a = t.services.pool.analytics('24h');
    expect(a.totals.requests).toBe(2);
    expect(a.totals.successRate).toBe(0.5);
    expect(a.providers.find((p) => p.id === 'groq')).toMatchObject({ requests: 1, successRate: 0 });
    expect(a.providers.find((p) => p.id === 'cerebras')?.outlook).toBe('plenty left today');
    expect(a.models.map((m) => m.id).sort()).toEqual(['gpt-oss-120b', 'llama-3.3-70b-versatile']);
  });

  it('learned scores weigh recent days more (on) or the whole week the same (off)', () => {
    const t = setup(() => sse('ok'));
    const s = t.services;
    const day = (ago: number): string => new Date(Date.now() - ago * 86_400_000).toISOString();
    const add = (ago: number, ok: number) =>
      s.db
        .prepare(
          `INSERT INTO pool_calls (job, task, at, day, connection_id, provider, model, tier, ok, ms, input_tokens, output_tokens)
           VALUES ('j', 't', ?, ?, 'conn_groq', 'groq', 'llama-3.3-70b-versatile', 2, ?, 1000, 10, 10)`,
        )
        .run(day(ago), day(ago).slice(0, 10), ok);
    // Failed a lot six days ago, fine today.
    for (let i = 0; i < 8; i++) add(6, 0);
    for (let i = 0; i < 4; i++) add(0, 1);
    const groq = () => s.pool.routes().find((r) => r.provider === 'groq')?.stats;
    expect(groq()?.ok).toBeCloseTo(4);
    expect(groq()?.fail).toBeCloseTo(1, 0);
    s.settings.set('pool.learn', false);
    expect(groq()).toMatchObject({ ok: 4, fail: 8 });
  });
});
