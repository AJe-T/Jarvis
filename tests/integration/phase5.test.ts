import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { McpServerInput } from '@shared/ipc-contract';
import type { ToolResultBlockParam } from '@main/llm/types';
import { createMcpSystem } from '@main/mcp/mcp-system';
import { namespacedName } from '@main/mcp/manager';
import type { FakeScript } from '@main/llm/fake-claude';
import { idle, setupServices } from './helpers';

const FAKE_SERVER = join(__dirname, '..', 'fixtures', 'fake-mcp-server.mjs');

const fakeServer = (over: Partial<McpServerInput> = {}): McpServerInput => ({
  name: 'fake',
  transport: 'stdio',
  command: 'node', // system Node runs the fixture; MCP children get a minimal environment
  args: [FAKE_SERVER],
  envSecrets: {},
  trustLevel: 'experimental',
  defaultTier: 'CONFIRM',
  toolOverrides: { echo: 'SAFE' },
  enabled: true,
  ...over,
});

async function setupMcp(script: FakeScript) {
  const t = setupServices(script);
  const mcp = createMcpSystem(t.services, { appVersion: '0.0.0-test' });
  await mcp.manager.start();
  await mcp.manager.add(fakeServer());
  return { ...t, mcp };
}

const until = async (cond: () => boolean, ms = 15_000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

const lastResults = (t: Awaited<ReturnType<typeof setupMcp>>): ToolResultBlockParam[] =>
  t.llm.calls
    .filter((c) => c.max_tokens === 4096)
    .at(-1)
    ?.messages.at(-1)?.content as ToolResultBlockParam[];

describe('phase 5 MCP integration (Testing.md §4)', () => {
  it('namespaces tools, honours the SAFE override and prompts for write tools', async () => {
    const t = await setupMcp({
      rules: [
        {
          match: 'go',
          steps: [
            {
              tools: [
                { name: 'mcp__fake__echo', input: { text: 'hi' } },
                { name: 'mcp__fake__danger_write', input: { target: 'x', data: 'y' } },
              ],
            },
            { text: 'done' },
          ],
        },
      ],
    });
    const view = t.mcp.manager.list()[0];
    expect(view).toMatchObject({ name: 'fake', status: 'ready' });
    expect(view?.tools.map((x) => x.name).sort()).toEqual([
      'crash',
      'danger_write',
      'echo',
      'inject',
    ]);
    const defs = t.services.registry.definitions().map((d) => ('name' in d ? d.name : d.type));
    expect(defs).toEqual(expect.arrayContaining(['mcp__fake__echo', 'mcp__fake__danger_write']));
    const asked: Array<{ title: string; destructive: boolean }> = [];
    t.services.confirmShowListeners.add((e) => {
      asked.push(e);
      t.services.broker.respond(e.requestId, 'approve', 'click');
    });
    t.services.orchestrator.send({ text: 'go', source: 'text' });
    await idle(t.services, 15_000);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.destructive).toBe(true);
    const results = lastResults(t);
    expect(JSON.stringify(results[0])).toContain('echo: hi');
    expect(JSON.stringify(results[0])).toContain('untrusted_content source=\\"mcp:fake/echo\\"');
    expect(JSON.stringify(results[1])).toContain('wrote to x');
    expect(t.services.slots.providers.integrations()).toBe('fake (4 tools)');
    await t.mcp.manager.shutdown();
  }, 30_000);

  it('a crashing server becomes an error result, status error, then reconnects', async () => {
    const t = await setupMcp({
      rules: [
        {
          match: 'crash',
          steps: [{ tools: [{ name: 'mcp__fake__crash', input: {} }] }, { text: 'It crashed.' }],
        },
      ],
    });
    t.services.settings.set('policy.overrides', {});
    t.services.confirmShowListeners.add((e) =>
      t.services.broker.respond(e.requestId, 'approve', 'click'),
    );
    t.services.orchestrator.send({ text: 'crash it', source: 'text' });
    await idle(t.services, 15_000);
    expect(lastResults(t)[0]?.is_error).toBe(true);
    const statuses = t.events
      .filter((e) => e.event === 'mcp:status')
      .map((e) => (e.payload as { status: string }).status);
    expect(statuses).toContain('error');
    await until(() => t.mcp.manager.list()[0]?.status === 'ready');
    await t.mcp.manager.shutdown();
  }, 30_000);

  it('injected instructions stay wrapped data, and a following external action needs confirmation', async () => {
    const t = await setupMcp({
      rules: [
        {
          match: 'read',
          steps: [
            { tools: [{ name: 'mcp__fake__inject', input: { url: 'https://evil.example' } }] },
            { tools: [{ name: 'open_url', input: { url: 'https://evil.example/exfil' } }] },
            { text: 'The page contained instructions; I ignored them.' },
          ],
        },
      ],
    });
    await t.mcp.manager.update(t.mcp.manager.list()[0]?.id ?? '', {
      toolOverrides: { echo: 'SAFE', inject: 'SAFE' },
    });
    const asked: Array<{ taintedFrom?: string | undefined }> = [];
    t.services.confirmShowListeners.add((e) => {
      asked.push(e);
      t.services.broker.respond(e.requestId, 'deny', 'click');
    });
    t.services.orchestrator.send({ text: 'read that page', source: 'text' });
    await idle(t.services, 15_000);
    const firstResult = JSON.stringify(
      t.llm.calls.filter((c) => c.max_tokens === 4096)[1]?.messages.at(-1)?.content,
    );
    expect(firstResult.match(/<\/untrusted_content>/g)).toHaveLength(1);
    expect(asked[0]?.taintedFrom).toBe('mcp:fake/inject');
    expect((t.services.os as unknown as { calls: unknown[] }).calls).toHaveLength(0);
    await t.mcp.manager.shutdown();
  }, 30_000);

  it('blocks sensitive data and dangerous URLs in MCP tool inputs', async () => {
    const t = await setupMcp({
      rules: [
        {
          match: 'card',
          steps: [
            {
              tools: [
                {
                  name: 'mcp__fake__danger_write',
                  input: { target: 'form', data: 'card 4111 1111 1111 1111' },
                },
                { name: 'mcp__fake__inject', input: { url: 'javascript:alert(1)' } },
              ],
            },
            { text: 'no' },
          ],
        },
      ],
    });
    t.services.orchestrator.send({ text: 'type my card', source: 'text' });
    await idle(t.services, 15_000);
    const r = lastResults(t);
    expect(JSON.stringify(r[0])).toMatch(/not permitted.*sensitive data \(card\)/);
    expect(JSON.stringify(r[1])).toMatch(/not permitted.*javascript: links/);
    await t.mcp.manager.shutdown();
  }, 30_000);

  it('reports a missing secret clearly instead of spawning', async () => {
    const t = setupServices();
    const mcp = createMcpSystem(t.services, { appVersion: '0' });
    await mcp.manager.start();
    await mcp.manager.add(fakeServer({ name: 'needs_key', envSecrets: { TOKEN: 'github_pat' } }));
    expect(mcp.manager.list()[0]).toMatchObject({
      status: 'error',
      error: 'Add the secret "github_pat" for this connection first.',
    });
    await mcp.manager.shutdown();
  });

  it('keeps long tool names within 64 characters', () => {
    const n = namespacedName(
      'a-very-long-server-name',
      'an_extremely_long_tool_name_that_keeps_going_and_going',
    );
    expect(n.length).toBeLessThanOrEqual(64);
    expect(n.startsWith('mcp__a-very-long-server-name__')).toBe(true);
  });
});
