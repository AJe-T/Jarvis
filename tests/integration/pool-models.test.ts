import { describe, expect, it } from 'vitest';
import { createConnections } from '@main/llm/connections';
import { setupServices } from './helpers';
import { sse } from './pool-fakes';

/**
 * 2.33.1: Sir added a Groq and an OpenRouter key as extra connections and chose no model. The
 * Models tab was empty: only chosen and starred models joined. Now every free chat model a key's
 * list shows joins, with its context size and its limits.
 */

const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
const OR_MODELS = 'https://openrouter.ai/api/v1/models';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';

const json = (body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...headers },
  });

function setup() {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push(url);
    if (url === GROQ_MODELS)
      return json({
        data: [
          { id: 'llama-3.3-70b-versatile', context_window: 131072 },
          { id: 'openai/gpt-oss-120b', context_window: 131072 },
          { id: 'whisper-large-v3', context_window: 448 },
          { id: 'meta-llama/llama-prompt-guard-2-86m', context_window: 512 },
        ],
      });
    if (url === OR_MODELS)
      return json({
        data: [
          {
            id: 'deepseek/deepseek-chat-v3.1:free',
            context_length: 163840,
            pricing: { prompt: '0', completion: '0' },
          },
          {
            id: 'openai/gpt-5',
            context_length: 400000,
            pricing: { prompt: '0.00000125', completion: '0.00001' },
          },
        ],
      });
    if (url === GROQ_CHAT) {
      const r = sse('Hi.');
      return new Response(r.body, {
        headers: {
          'content-type': 'text/event-stream',
          'x-ratelimit-limit-requests': '1000',
          'x-ratelimit-limit-tokens': '12000',
        },
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof globalThis.fetch;
  const t = setupServices({ rules: [] }, { fetch });
  const s = t.services;
  // Exactly Sir's setup: an extra key per provider, no model chosen, nothing starred.
  const groq = s.connections.add('groq', '');
  const or = s.connections.add('openrouter', '');
  s.secrets.set(groq.secret, 'gsk_test_groq_key_0000');
  s.secrets.set(or.secret, 'sk-or-v1-test-0000');
  return { ...t, calls, groq, or };
}

describe('pool models from keys with nothing chosen', () => {
  it('Check keys lists every free chat model the keys can use, with context sizes', async () => {
    const t = setup();
    const s = t.services;
    expect(s.pool.snapshot().models).toEqual([]);

    await s.pool.checkKeys();
    const models = s.pool.snapshot().models;
    expect(models.map((m) => m.id).sort()).toEqual([
      'deepseek/deepseek-chat-v3.1:free',
      'llama-3.3-70b-versatile',
      'openai/gpt-oss-120b',
    ]);
    // Speech and safety-filter models never join; OpenRouter's paid models never join.
    expect(models.find((m) => m.id === 'llama-3.3-70b-versatile')?.contextK).toBe(131);
    expect(models.find((m) => m.id.endsWith(':free'))?.routes[0]?.limits).toEqual({
      rpm: 20,
      rpd: 50,
    });
  });

  it('a chosen or starred model still decides alone; the On switch takes a model out', async () => {
    const t = setup();
    const s = t.services;
    await s.pool.checkKeys();
    s.connections.setModel(t.groq.id, 'openai/gpt-oss-120b');
    expect(
      s.pool
        .routes()
        .filter((r) => r.provider === 'groq')
        .map((r) => r.model),
    ).toEqual(['openai/gpt-oss-120b']);
    s.settings.set('pool.models', { 'deepseek/deepseek-chat-v3.1:free': { enabled: false } });
    expect(s.pool.routes().find((r) => r.model.endsWith(':free'))?.enabled).toBe(false);
  });

  it("learns Groq's limits per model from its reply headers", async () => {
    const t = setup();
    const s = t.services;
    s.connections.setModel(t.groq.id, 'llama-3.3-70b-versatile');
    s.settings.set('pool.providers', { openrouter: { enabled: false } });
    await s.pool.checkKeys();
    await s.pool
      .session({ id: 'j1', task: 't' })
      .stream(
        { model: 'pool', max_tokens: 50, messages: [{ role: 'user', content: 'Hi' }] },
        { signal: new AbortController().signal },
      );
    const route = s.pool.routes().find((r) => r.model === 'llama-3.3-70b-versatile');
    expect(route?.limits).toEqual({ rpd: 1000, tpm: 12000 });
  });
});

describe('a key pasted into a connection name', () => {
  it('is refused, and one saved before is replaced by the default name', () => {
    const t = setup();
    const s = t.services;
    expect(() => s.connections.add('groq', 'gsk_Fake0Test1Key2Value3Abc4Def5Ghi6Jkl7Mno8')).toThrow(
      /key in a connection name/,
    );
    expect(() =>
      s.connections.rename(t.groq.id, 'gsk_Fake0Test1Key2Value3Abc4Def5Ghi6Jkl7Mno8'),
    ).toThrow(/key in a connection name/);
    s.db
      .prepare('UPDATE ai_connections SET label = ? WHERE id = ?')
      .run('gsk_Fake0Test1Key2Value3Abc4Def5Ghi6Jkl7Mno8', t.groq.id);
    const again = createConnections({ db: s.db, settings: s.settings, secrets: s.secrets });
    expect(again.list().find((c) => c.id === t.groq.id)?.label).toBe('Groq (fast open models) (2)');
  });
});
