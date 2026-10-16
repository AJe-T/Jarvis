import { describe, expect, it } from 'vitest';
import { CLOUD_PROVIDERS, cloudProvider, type CloudProviderId } from '@shared/llm-providers';
import {
  ThinkFilter,
  checkCloudUrl,
  checkLocalUrl,
  createLocalClient,
  selectTools,
  toOpenAiMessages,
  toOpenAiTools,
} from './local-client';

describe('local model client (ADR-013)', () => {
  it('translates tool calls and results to the OpenAI shape', () => {
    const out = toOpenAiMessages(
      [{ type: 'text', text: 'You are JARVIS.' }],
      [
        { role: 'user', content: 'what time is it' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking.' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_datetime', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [{ type: 'text', text: '09:30' }],
            },
            { type: 'text', text: 'and the date?' },
          ],
        },
      ],
    );
    expect(out).toEqual([
      { role: 'system', content: 'You are JARVIS.' },
      { role: 'user', content: 'what time is it' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [
          { id: 'toolu_1', type: 'function', function: { name: 'get_datetime', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: '09:30' },
      { role: 'user', content: 'and the date?' },
    ]);
  });

  it('turns tools into functions, taking schemas from the catalog and dropping API-only tools', () => {
    const tools = toOpenAiTools(
      [
        {
          name: 'get_datetime',
          description: 'Time',
          input_schema: { type: 'object', properties: {} },
        },
        { type: 'memory_20250818', name: 'memory' } as never,
        { type: 'web_search_20260318', name: 'web_search' } as never,
      ],
      () => [{ name: 'memory', description: 'Memory tool', inputSchema: { type: 'object' } }],
    );
    expect(tools.map((t) => t.function.name)).toEqual(['get_datetime', 'memory']);
    expect(tools[1]?.function.description).toBe('Memory tool');
  });

  it('hides <think> reasoning even when tags are split across chunks', () => {
    const f = new ThinkFilter();
    const out = ['Hi <thi', 'nk>secret plan</th', 'ink> there', ' sir']
      .map((d) => f.push(d))
      .join('');
    expect(out).toBe('Hi  there sir');
  });

  it('only accepts servers on this PC or the home network', () => {
    expect(checkLocalUrl('http://localhost:11434/v1').hostname).toBe('localhost');
    expect(checkLocalUrl('http://192.168.1.20:1234/v1').port).toBe('1234');
    expect(() => checkLocalUrl('https://api.example.com/v1')).toThrow();
    expect(() => checkLocalUrl('file:///etc/passwd')).toThrow();
  });
});

describe('local server key (FreeLLMAPI and other keyed servers)', () => {
  const client = (key: string | undefined, seen: Array<RequestInit['headers']>) =>
    createLocalClient({
      baseUrl: () => 'http://localhost:3001/v1',
      model: () => 'auto',
      catalog: () => [],
      apiKey: () => key,
      fetch: (async (_url: string, init?: RequestInit) => {
        seen.push(init?.headers);
        return Response.json({ data: [{ id: 'auto' }] });
      }) as typeof fetch,
    });

  it('sends the key as a Bearer token only when one is saved', async () => {
    const withKey: Array<RequestInit['headers']> = [];
    expect(await client('freellmapi-abc', withKey).listModels()).toEqual(['auto']);
    expect(withKey[0]).toEqual({ authorization: 'Bearer freellmapi-abc' });
    const without: Array<RequestInit['headers']> = [];
    await client(undefined, without).listModels();
    expect(without[0]).toEqual({});
  });
});

describe('tool routing for local models (idea from isair/jarvis)', () => {
  const tool = (name: string, description: string) => ({
    type: 'function' as const,
    function: { name, description, parameters: {} },
  });
  const many = [
    tool('get_datetime', 'Current date and time'),
    tool('search_memory', 'Search memory notes'),
    tool('memory', 'Read and write memory files'),
    tool('get_weather', 'Weather forecast for a town'),
    tool('set_volume', 'Change the speaker volume'),
    tool('open_app', 'Open an installed application'),
    ...Array.from({ length: 20 }, (_, i) => tool(`other_${i}`, 'Something unrelated entirely')),
  ];

  it('offers core tools plus the ones matching the request', () => {
    const picked = selectTools(many, [{ role: 'user', content: "What's the weather like?" }]);
    expect(picked.map((t) => t.function.name)).toEqual([
      'get_datetime',
      'search_memory',
      'memory',
      'get_weather',
    ]);
  });

  it('keeps tools this turn already called, and passes short lists through', () => {
    const picked = selectTools(many, [
      { role: 'user', content: 'turn the volume down' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'open_app', input: {} }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    ]);
    expect(picked.map((t) => t.function.name)).toEqual(
      expect.arrayContaining(['set_volume', 'open_app']),
    );
    expect(selectTools(many.slice(0, 5), [{ role: 'user', content: 'hi' }])).toHaveLength(5);
  });
});

describe('cloud providers (OpenAI, Gemini, DeepSeek… through the same translation)', () => {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';
  const sse = (...events: object[]): Response =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');
  const client = (base: string, key: string | undefined, urls: string[] = []) =>
    createLocalClient({
      baseUrl: () => base,
      model: () => 'gemini-flash',
      catalog: () => [],
      apiKey: () => key,
      cloud: { name: () => 'Google Gemini', allowedBaseUrls: [GEMINI] },
      fetch: (async (url: string) => {
        urls.push(url);
        return url.endsWith('/models')
          ? Response.json({ data: [{ id: 'models/gemini-flash' }] })
          : sse(
              { choices: [{ delta: { content: 'Hi, sir.' } }] },
              {
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 3, completion_tokens: 2 },
              },
            );
      }) as typeof fetch,
    });
  const req = { model: 'x', max_tokens: 100, messages: [{ role: 'user' as const, content: 'hi' }] };

  it('only talks to the catalogue address, and needs a key', async () => {
    expect(() => checkCloudUrl('https://evil.example/v1', [GEMINI])).toThrow();
    await expect(client('https://evil.example/v1', 'k').listModels()).rejects.toThrow();
    const err = await client(GEMINI, undefined)
      .listModels()
      .catch((e: unknown) => e);
    expect((err as { userMessage?: string }).userMessage).toMatch(/API key/);
  });

  it('accepts "models/<id>" listings and bills the reply (not the free local_ id)', async () => {
    const urls: string[] = [];
    const c = client(GEMINI, 'AIza-test', urls);
    await expect(c.ping('', AbortSignal.timeout(1000))).resolves.toBeUndefined();
    const msg = await c.stream(req, { signal: new AbortController().signal });
    expect(urls.at(-1)).toBe(`${GEMINI}/chat/completions`);
    expect(msg.id.startsWith('cloud_')).toBe(true);
    expect(msg.usage.output_tokens).toBe(2);
  });
});

describe('gateways: how each one lists its models (shared/llm-providers.ts)', () => {
  const base = (id: CloudProviderId): string => cloudProvider(id).baseUrl;
  const gateway = (
    id: CloudProviderId,
    respond: (url: string, init?: RequestInit) => Response,
    seen: Array<{ url: string; body?: string }> = [],
  ) => {
    const p = cloudProvider(id);
    return createLocalClient({
      baseUrl: () => p.baseUrl,
      model: () => 'some-model',
      catalog: () => [],
      apiKey: () => 'k',
      cloud: {
        name: () => p.label,
        allowedBaseUrls: CLOUD_PROVIDERS.map((c) => c.baseUrl),
        allowedModelUrls: ['https://ollama.com/api/tags'],
        listing: () => ({ kind: p.models, url: p.modelsUrl }),
      },
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
        return respond(url, init);
      }) as typeof fetch,
    });
  };
  const userMessage = (e: unknown): string => (e as { userMessage?: string }).userMessage ?? '';

  it('every catalogue address is HTTPS and every id, secret and address is unique', () => {
    for (const p of CLOUD_PROVIDERS) {
      expect(p.baseUrl.startsWith('https://')).toBe(true);
      expect(p.docsUrl.startsWith('https://')).toBe(true);
      expect(p.models === 'ollama').toBe(Boolean((p as { modelsUrl?: string }).modelsUrl));
    }
    for (const k of ['id', 'secret', 'baseUrl'] as const)
      expect(new Set(CLOUD_PROVIDERS.map((p) => p[k])).size).toBe(CLOUD_PROVIDERS.length);
  });

  it('a provider with no model list says so, and Test sends one 1-token request', async () => {
    const seen: Array<{ url: string; body?: string }> = [];
    const c = gateway('deepinfra', () => Response.json({ choices: [] }), seen);
    expect(userMessage(await c.listModels().catch((e: unknown) => e))).toMatch(/model list/);
    expect(seen).toHaveLength(0);
    await expect(c.ping('', AbortSignal.timeout(1000))).resolves.toBeUndefined();
    expect(seen[0]?.url).toBe(`${base('deepinfra')}/chat/completions`);
    expect(JSON.parse(seen[0]?.body ?? '{}')).toMatchObject({ model: 'some-model', max_tokens: 1 });
  });

  it('the 1-token test reports a rejected key or a refused model', async () => {
    const denied = gateway('fireworks', () => new Response('nope', { status: 401 }));
    expect(
      userMessage(await denied.ping('', AbortSignal.timeout(1000)).catch((e: unknown) => e)),
    ).toMatch(/rejected the API key/);
    const missing = gateway('fireworks', () => new Response('no such model', { status: 404 }));
    expect(
      userMessage(await missing.ping('', AbortSignal.timeout(1000)).catch((e: unknown) => e)),
    ).toMatch(/refused "some-model"/);
  });

  it('never puts the key in the error, and names credit / busy failures', async () => {
    const c = createLocalClient({
      baseUrl: () => base('deepinfra'),
      model: () => 'm',
      catalog: () => [],
      apiKey: () => 'k-secret-1',
      cloud: {
        name: () => 'DeepInfra',
        allowedBaseUrls: [base('deepinfra')],
        listing: () => ({ kind: 'manual' }),
      },
      fetch: async () => new Response('Bearer k-secret-1 is wrong model', { status: 400 }),
    });
    const err = await c.ping('', AbortSignal.timeout(1000)).catch((e: unknown) => e);
    expect(userMessage(err)).not.toContain('k-secret-1');
    expect(String((err as Error).message)).not.toContain('k-secret-1');
    const busy = gateway('fireworks', () => new Response('slow down', { status: 429 }));
    expect(
      userMessage(await busy.ping('', AbortSignal.timeout(1000)).catch((e: unknown) => e)),
    ).toMatch(/busy/);
    const broke = gateway('fireworks', () => new Response('', { status: 402 }));
    expect(
      userMessage(await broke.ping('', AbortSignal.timeout(1000)).catch((e: unknown) => e)),
    ).toMatch(/credit/);
  });

  it('refuses a model-list address outside the catalogue, and a list that is not JSON', async () => {
    const p = cloudProvider('ollamacloud');
    const evil = createLocalClient({
      baseUrl: () => p.baseUrl,
      model: () => 'm',
      catalog: () => [],
      apiKey: () => 'k',
      cloud: {
        name: () => p.label,
        allowedBaseUrls: [p.baseUrl],
        allowedModelUrls: ['https://ollama.com/api/tags'],
        listing: () => ({ kind: 'ollama', url: 'https://evil.example/api/tags' }),
      },
      fetch: async () => Response.json({ models: [] }),
    });
    await expect(evil.listModels()).rejects.toThrow();
    const html = gateway('huggingface', () => new Response('<html>captive portal</html>'));
    expect(userMessage(await html.listModels().catch((e: unknown) => e))).toMatch(/reach/);
  });

  it("Ollama cloud's list comes from its fixed /api/tags address", async () => {
    const seen: Array<{ url: string }> = [];
    const c = gateway(
      'ollamacloud',
      () => Response.json({ models: [{ name: 'gpt-oss:120b' }, { model: 'qwen3:480b' }, {}] }),
      seen,
    );
    expect(await c.listModels()).toEqual(['gpt-oss:120b', 'qwen3:480b']);
    expect(seen[0]?.url).toBe('https://ollama.com/api/tags');
  });

  it('OpenAI-style gateways list from {baseUrl}/models', async () => {
    const seen: Array<{ url: string }> = [];
    const c = gateway('huggingface', () => Response.json({ data: [{ id: 'some-model' }] }), seen);
    await expect(c.ping('', AbortSignal.timeout(1000))).resolves.toBeUndefined();
    expect(seen[0]?.url).toBe(`${base('huggingface')}/models`);
  });
});
