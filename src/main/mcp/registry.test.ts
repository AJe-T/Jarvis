import { describe, expect, it } from 'vitest';
import { INVOKE } from '@shared/ipc-contract';
import { isPrivateHost, REGISTRY_URL, searchRegistry, slugFor, toEntry } from './registry';

// Shapes copied from a live registry.modelcontextprotocol.io/v0/servers response (2026-10).
const PAGE = {
  servers: [
    {
      server: {
        name: 'io.github.WeAreBraveLabs/domain-checker-mcp',
        description: 'Fast domain availability checker.',
        repository: {
          url: 'https://github.com/WeAreBraveLabs/domain-checker-mcp',
          source: 'github',
        },
        version: '1.0.1',
        packages: [
          {
            registryType: 'npm',
            identifier: '@wearebravelabs/domain-checker-mcp',
            version: '1.0.1',
            transport: { type: 'stdio' },
            environmentVariables: [
              {
                name: 'CHECKER_API_KEY',
                description: 'Your key',
                isRequired: true,
                isSecret: true,
              },
              { name: 'CHECKER_LOG', isRequired: false },
            ],
          },
        ],
      },
    },
    {
      server: {
        name: 'ai.smithery/brave',
        description: 'Search the web.',
        version: '2.0.58',
        remotes: [
          {
            type: 'streamable-http',
            url: 'https://server.smithery.ai/brave/mcp',
            headers: [
              { name: 'Authorization', value: 'Bearer {smithery_api_key}', isRequired: true },
            ],
          },
        ],
      },
    },
    // Python-only: Jarvis can't run it as-is.
    {
      server: {
        name: 'com.mcparmory/notion',
        version: '1.0.1',
        packages: [{ registryType: 'pypi', identifier: 'mcparmory-notion', version: '1.0.1' }],
      },
    },
    // A shell-looking "package name" never reaches npx.
    {
      server: {
        name: 'evil/pkg',
        version: '1.0.0',
        packages: [{ registryType: 'npm', identifier: 'x & calc.exe', version: '1.0.0' }],
      },
    },
    { server: { name: 'broken' } },
  ],
  metadata: { nextCursor: 'com.mcparmory/notion:1.0.1', count: 5 },
};

const fakeFetch = (body: unknown, seen: string[] = []): typeof fetch =>
  (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

describe('MCP Registry search', () => {
  it('keeps npm-over-stdio and Bearer remotes, skips the rest', async () => {
    const seen: string[] = [];
    const page = await searchRegistry({ query: 'brave' }, fakeFetch(PAGE, seen));
    expect(seen[0]).toBe(`${REGISTRY_URL}?limit=30&version=latest&search=brave`);
    expect(page.skipped).toBe(3);
    expect(page.nextCursor).toBe('com.mcparmory/notion:1.0.1');
    const [npm, remote] = page.entries;
    expect(npm?.server).toMatchObject({
      name: 'domain-checker-mcp',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@wearebravelabs/domain-checker-mcp@1.0.1'],
      envSecrets: { CHECKER_API_KEY: 'reg_domain_checker_mcp_checker_api_key' },
      trustLevel: 'community',
      defaultTier: 'CONFIRM',
    });
    expect(npm?.secrets.map((s) => s.label)).toEqual(['CHECKER_API_KEY']);
    expect(remote?.server).toMatchObject({
      name: 'brave',
      transport: 'http',
      url: 'https://server.smithery.ai/brave/mcp',
      authSecret: 'reg_brave_token',
    });
    // Every entry is something mcp:add accepts.
    for (const e of page.entries)
      expect(INVOKE['mcp:add'].request.safeParse(e.server).success).toBe(true);
  });

  it('rejects plain-http remotes and remotes with other required headers', () => {
    const base = { name: 'x/y', version: '1.0.0' };
    expect(
      toEntry({ ...base, remotes: [{ type: 'streamable-http', url: 'http://a.b/mcp' }] }),
    ).toBe(null);
    expect(
      toEntry({
        ...base,
        remotes: [
          {
            type: 'streamable-http',
            url: 'https://a.b/mcp',
            headers: [{ name: 'X-Project', isRequired: true }],
          },
        ],
      }),
    ).toBe(null);
  });

  it("never derives a secret name that is one of Sir's existing keys", () => {
    const e = toEntry({
      name: 'evil/notion',
      version: '1.0.0',
      remotes: [
        {
          type: 'streamable-http',
          url: 'https://evil.example/mcp',
          headers: [{ name: 'Authorization', value: 'Bearer {t}', isRequired: true }],
        },
      ],
    });
    expect(e?.server.authSecret).toBe('reg_notion_token');
  });

  it('rejects private hosts, URL credentials and env vars that steer node or npx', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.2',
      '169.254.169.254',
      'intranet',
      '[::1]',
    ])
      expect(isPrivateHost(h)).toBe(true);
    expect(isPrivateHost('mcp.example.com')).toBe(false);
    const remote = (url: string) =>
      toEntry({ name: 'x/y', version: '1.0.0', remotes: [{ type: 'streamable-http', url }] });
    expect(remote('https://user:pw@mcp.example.com/mcp')).toBe(null);
    expect(remote('https://192.168.1.10/mcp')).toBe(null);
    const pkg = (env: string) =>
      toEntry({
        name: 'x/y',
        version: '1.0.0',
        packages: [
          {
            registryType: 'npm',
            identifier: 'some-mcp',
            version: '1.0.0',
            environmentVariables: [{ name: env, isRequired: true }],
          },
        ],
      });
    expect(pkg('NODE_OPTIONS')).toBe(null);
    expect(pkg('NPM_CONFIG_REGISTRY')).toBe(null);
    expect(pkg('SOME_API_KEY')).not.toBe(null);
  });

  it('turns registry names into valid connection names', () => {
    expect(slugFor('io.github.someone/Brave-Search')).toBe('brave-search');
    expect(slugFor('a/1')).toMatch(/^[a-z][a-z0-9_-]{1,30}$/);
    expect(slugFor(`x/${'long'.repeat(20)}`).length).toBeLessThanOrEqual(31);
  });

  it('reports an unreachable or malformed registry as a friendly error', async () => {
    const down = (async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    await expect(searchRegistry({ query: '' }, down)).rejects.toThrow(/registry/);
    await expect(searchRegistry({ query: '' }, fakeFetch({ nope: 1 }))).rejects.toThrow(
      /registry shape/,
    );
    const huge = (async () =>
      new Response('x', { headers: { 'content-length': '9000000' } })) as unknown as typeof fetch;
    await expect(searchRegistry({ query: '' }, huge)).rejects.toThrow(/too large/);
  });
});
