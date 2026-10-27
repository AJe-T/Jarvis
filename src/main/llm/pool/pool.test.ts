import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../db/connection';
import { createSettingsRepo } from '../../db/repos/settings-repo';
import { createSettingsService } from '../../settings/settings-service';
import { createConnections } from '../connections';
import type { LlmRequest } from '../types';
import { createCustomProviders, type Lookup } from './custom';
import { createFreePool, type Tier3Answer } from './pool';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const sse = (...events: object[]): Response =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');

function setup(opts: { answer?: Tier3Answer } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  const settings = createSettingsService(createSettingsRepo(db));
  const store = new Map<string, string>();
  const secrets = {
    get: (n: string) => store.get(n),
    set: (n: string, v: string) => {
      store.set(n, v);
      return { last4: v.slice(-4) };
    },
    delete: (n: string) => void store.delete(n),
  };
  let ip = '104.18.1.1';
  const lookup: Lookup = async () => [{ address: ip }];
  const seen: Array<{ url: string; body: Record<string, unknown>; redirect?: string }> = [];
  const asks: Array<{ everyTime: boolean }> = [];
  const connections = createConnections({ db, settings, secrets });
  const custom = createCustomProviders({ db, secrets, lookup });
  const pool = createFreePool({
    db,
    settings,
    secrets,
    connections,
    custom,
    catalog: () => [],
    ask: async (q) => {
      asks.push(q);
      return opts.answer ?? 'once';
    },
    claudePrice: () => ({
      inPerMTok: 3,
      outPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    }),
    lookup,
    fetch: (async (url: string, init?: RequestInit) => {
      seen.push({
        url,
        body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
          string,
          unknown
        >,
        ...(init?.redirect ? { redirect: init.redirect } : {}),
      });
      return sse(
        // A relay that calls a tool it was never offered: dropped.
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'get_weather', arguments: '{}' } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: { content: 'Drift: a slow change.' } }] },
        {
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 5, completion_tokens: 4 },
        },
      );
    }) as typeof fetch,
  });
  return { db, settings, secrets, custom, pool, seen, asks, setIp: (v: string) => (ip = v) };
}

const signal = new AbortController().signal;
const req: LlmRequest = {
  model: 'pool',
  max_tokens: 200,
  system: [{ type: 'text', text: "You are JARVIS. Sir's address is 1 Main Street." }],
  tools: [
    {
      name: 'get_weather',
      description: 'Weather',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What does drift mean?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ],
    },
    { role: 'assistant', content: 'Earlier answer from another AI.' },
    { role: 'user', content: 'Follow-up with tool results.' },
  ],
};
const relay = {
  name: 'Pollinations',
  baseUrl: 'https://gen.pollinations.ai/v1',
  model: 'openai',
  apiKey: 'pk-1234',
};

describe('AI Router: custom providers are tier 3 with every guard (Security.md §16.15)', () => {
  it('sends only the question: no system prompt, history, pictures or tools; drops made-up tool calls', async () => {
    const { pool, custom, seen, asks } = setup();
    await custom.add(relay);
    expect(pool.ready()).toBe(true);
    const s = pool.session({ id: 'job_1', task: 'define drift' });
    const msg = await s.stream(req, { signal });

    expect(asks).toEqual([{ soonestMin: null, everyTime: false }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://gen.pollinations.ai/v1/chat/completions');
    expect(seen[0]?.redirect).toBe('error');
    expect(seen[0]?.body['tools']).toBeUndefined();
    expect(seen[0]?.body['messages']).toEqual([
      { role: 'system', content: 'Answer the question clearly and briefly.' },
      { role: 'user', content: 'What does drift mean?' },
    ]);
    expect(msg.content.some((b) => b.type === 'tool_use')).toBe(false);
    expect(msg.stop_reason).toBe('end_turn');
    expect(s.trail.attempts).toEqual([
      { provider: 'custom_1', name: 'Pollinations', model: 'openai', tier: 3, ok: true },
    ]);
  });

  it('stays tier 3 whatever the settings say, and is never asked without consent', async () => {
    const { pool, custom, settings, seen } = setup({ answer: 'no' });
    await custom.add(relay);
    settings.set('pool.providers', { custom_1: { tier: 2 } });
    expect(pool.routes()[0]?.tier).toBe(3);
    await expect(pool.session({ id: 'j', task: 't' }).stream(req, { signal })).rejects.toThrow();
    expect(seen).toHaveLength(0);
    settings.set('pool.tier3', 'never');
    expect(pool.ready()).toBe(false);
  });

  it('"Ask every time" ignores "until Jarvis restarts"', async () => {
    const once = setup({ answer: 'session' });
    await once.custom.add(relay);
    await once.pool.session({ id: 'a', task: 't' }).stream(req, { signal });
    await once.pool.session({ id: 'b', task: 't' }).stream(req, { signal });
    expect(once.asks).toHaveLength(1);

    const every = setup({ answer: 'session' });
    every.settings.set('pool.tier3EveryTime', true);
    await every.custom.add(relay);
    await every.pool.session({ id: 'a', task: 't' }).stream(req, { signal });
    await every.pool.session({ id: 'b', task: 't' }).stream(req, { signal });
    expect(every.asks).toEqual([
      { soonestMin: null, everyTime: true },
      { soonestMin: null, everyTime: true },
    ]);
  });

  it('sends nothing when the host starts resolving to a private address (DNS rebinding)', async () => {
    const { pool, custom, seen, setIp } = setup();
    await custom.add(relay);
    setIp('192.168.1.10');
    await expect(pool.session({ id: 'j', task: 't' }).stream(req, { signal })).rejects.toThrow();
    expect(seen).toHaveLength(0);
  });
});

describe('AI Router: Cloudflare Workers AI (tier 2, fixed address + Account ID)', () => {
  it('joins the pool only with a valid Account ID, put into the fixed address by code', async () => {
    const { pool, settings, secrets, seen, asks } = setup();
    secrets.set('cloudflare', 'cf-token');
    settings.set('llm.cloud.models', { cloudflare: '@cf/meta/llama-3.1-8b-instruct' });
    expect(pool.routes()).toEqual([]);
    expect(() => settings.set('llm.cloud.cloudflareAccount', 'ABC/../evil')).toThrow();
    settings.set('llm.cloud.cloudflareAccount', ACCOUNT);
    expect(pool.routes().map((r) => [r.provider, r.tier])).toEqual([['cloudflare', 2]]);

    await pool.session({ id: 'j', task: 't' }).stream(req, { signal });
    expect(asks).toEqual([]);
    expect(seen[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`,
    );
    // Tier 2 keeps the task as Claude wrote it (tools included).
    expect(seen[0]?.body['tools']).toBeDefined();
  });
});
