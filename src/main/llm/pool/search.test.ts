import { describe, expect, it } from 'vitest';
import type { SettingsService } from '../../settings/settings-service';
import { createFreeSearch, PrivateQueryError, SearchExhaustedError } from './search';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers });

function setup(keys: Record<string, string>, reply: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply(url, init);
  }) as unknown as typeof globalThis.fetch;
  const settings = { get: () => true } as unknown as SettingsService;
  const secrets = {
    get: (n: string) => keys[n],
    status: () =>
      Object.fromEntries(
        Object.entries(keys).map(([k, v]) => [k, { set: true, last4: v.slice(-4) }]),
      ),
  };
  return { search: createFreeSearch({ settings, secrets, fetch, now: () => 0 }), calls };
}

const signal = new AbortController().signal;
const open = (): null => null;

describe('free web search', () => {
  it('asks Tavily first, with its Bearer key and the query, and reads its results', async () => {
    const { search, calls } = setup({ search_tavily: 'tvly-1234', search_exa: 'exa-1' }, () =>
      json({ results: [{ title: 'Tea', url: 'https://tea.example', content: 'Leaves.' }] }),
    );
    const out = await search.search('history of tea', 5, signal, open);
    expect(out).toEqual({
      provider: 'Tavily',
      results: [{ title: 'Tea', url: 'https://tea.example', snippet: 'Leaves.' }],
      tried: [],
    });
    expect(calls[0]?.url).toBe('https://api.tavily.com/search');
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      'Bearer tvly-1234',
    );
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      query: 'history of tea',
      max_results: 5,
    });
  });

  it('a used-up provider is paused and the next one in order answers', async () => {
    const { search, calls } = setup({ search_tavily: 'tvly-1', search_brave: 'brave-1' }, (url) =>
      url.startsWith('https://api.tavily.com')
        ? json({ detail: 'plan limit' }, 432)
        : json({ web: { results: [{ title: 'B', url: 'https://b.example', description: 'd' }] } }),
    );
    const out = await search.search('q one', 3, signal, open);
    expect(out.provider).toBe('Brave Search');
    expect(out.tried).toEqual([{ name: 'Tavily', reason: 'out of free credit' }]);
    expect(calls[1]?.url).toMatch(
      /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?q=q\+one/,
    );
    expect((calls[1]?.init.headers as Record<string, string>)['x-subscription-token']).toBe(
      'brave-1',
    );
    // Tavily stays paused: the next search goes straight to Brave.
    await search.search('q two', 3, signal, open);
    expect(calls.map((c) => new URL(c.url).host)).toEqual([
      'api.tavily.com',
      'api.search.brave.com',
      'api.search.brave.com',
    ]);
    expect(search.status().find((p) => p.id === 'tavily')?.pause?.reason).toBe(
      'out of free credit',
    );
    expect(search.usable()).toBe(true);
  });

  it('reads Exa, Firecrawl and Linkup replies', async () => {
    const replies: Record<string, unknown> = {
      'api.exa.ai': { results: [{ title: 'E', url: 'https://e.example', text: 'exa text' }] },
      'api.firecrawl.dev': {
        success: true,
        data: { web: [{ title: 'F', url: 'https://f.example', description: 'fc' }] },
      },
      'api.linkup.so': {
        results: [
          { type: 'image', name: 'pic', url: 'https://img.example/p.png' },
          { type: 'text', name: 'L', url: 'https://l.example', content: 'lu' },
        ],
      },
    };
    for (const [host, secret] of [
      ['api.exa.ai', 'search_exa'],
      ['api.firecrawl.dev', 'search_firecrawl'],
      ['api.linkup.so', 'search_linkup'],
    ] as const) {
      const { search } = setup({ [secret]: 'k' }, () => json(replies[host]));
      const out = await search.search('q', 5, signal, open);
      expect(out.results).toHaveLength(1);
      expect(out.results[0]?.url).toMatch(/^https:\/\/[efl]\.example$/);
    }
  });

  it('never sends a query the privacy gate refuses', async () => {
    const { search, calls } = setup({ search_tavily: 'tvly-1' }, () => json({ results: [] }));
    await expect(
      search.search('q', 5, signal, () => 'Memory and the vault earlier in this conversation'),
    ).rejects.toBeInstanceOf(PrivateQueryError);
    expect(calls).toHaveLength(0);
  });

  it('says so when every provider is used up or none has a key', async () => {
    const none = setup({}, () => json({}));
    await expect(none.search.search('q', 5, signal, open)).rejects.toBeInstanceOf(
      SearchExhaustedError,
    );
    expect(none.search.usable()).toBe(false);
    const busy = setup({ search_tavily: 't' }, () => json({}, 429, { 'retry-after': '60' }));
    await expect(busy.search.search('q', 5, signal, open)).rejects.toMatchObject({
      tried: [{ name: 'Tavily', reason: 'rate limited' }],
    });
    expect(busy.search.usable()).toBe(false);
  });
});
