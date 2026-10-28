import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { McpServerInput } from '@shared/ipc-contract';
import { createForge } from '@main/forge/forge';
import { createToolRunner, serverCommand, type McpAccess } from '@main/forge/tool-build';
import { mkdirSync } from 'node:fs';
import {
  GUARD_FILE,
  nodeRunsTools,
  RUNTIME_FILE,
  TOOL_GUARD,
  TOOL_RUNTIME,
} from '@main/forge/tool-runtime';

/**
 * Forge F3 end to end with the real Node on PATH: a (fake) boss writes a tool, Forge checks it in
 * Node's permission sandbox, lists its tools over MCP, and installs it as a connection.
 */
const nodeExe = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim();
const nodeVersion = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim();
const root = mkdtempSync(join(tmpdir(), 'forge-tools-'));
const outside = join(root, 'outside-secret.txt');
writeFileSync(outside, 'secret');

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Electron's rmSync can stop on Windows; it's a temp folder.
  }
});

const GOOD_TOOL = `import { readFile } from 'node:fs/promises';
export const tools = [
  {
    name: 'add_numbers',
    description: 'Adds two numbers and returns the sum as text.',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
    async run({ a, b }) { return String(a + b); },
  },
  {
    name: 'read_path',
    description: 'Reads a file (used here to prove the sandbox).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async run({ path }) { return await readFile(path, 'utf8'); },
  },
];
`;
const GOOD_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tools } from './tool.mjs';
test('adds', async () => {
  assert.equal(await tools[0].run({ a: 2, b: 3 }, { dataDir: './data' }), '5');
});
`;

function setup(files: Record<string, string>) {
  const forgeDir = join(root, `forge-${Math.random().toString(36).slice(2, 8)}`);
  const added: McpServerInput[] = [];
  const updated: string[] = [];
  const mcp: McpAccess = {
    list: () => added.map((a, i) => ({ ...a, id: `s${i}`, status: 'ready', tools: [] })),
    add: (input) => {
      added.push(input);
      return Promise.resolve();
    },
    update: (id) => {
      updated.push(id);
      return Promise.resolve();
    },
  };
  const forge = createForge({
    workspace: () => Promise.reject(new Error('not used')),
    boss: (input) => {
      for (const [name, text] of Object.entries(files))
        writeFileSync(join(input.repoDir, name), text);
      return Promise.resolve({ ok: true, summary: 'Built the tool.', costUsd: 0.1, turns: 3 });
    },
    repoUrl: () => '',
    budgetUsd: () => 5,
    announce: vi.fn(),
    runsDir: join(forgeDir, 'runs'),
    tools: {
      forgeDir,
      runner: (dir) => Promise.resolve(createToolRunner(nodeExe, dir)),
      mcp: () => mcp,
    },
  });
  return { forge, added, updated };
}

async function settle(forge: ReturnType<typeof createForge>): Promise<void> {
  await vi.waitFor(
    () => expect(['passed', 'failed', 'cancelled']).toContain(forge.status()?.state),
    { timeout: 60_000, interval: 200 },
  );
}

describe.skipIf(!nodeRunsTools(nodeVersion))('Forge self-built tools (real Node)', () => {
  it('builds, tests in the sandbox, lists its tools and installs as a connection', async () => {
    const { forge, added, updated } = setup({ 'tool.mjs': GOOD_TOOL, 'tool.test.mjs': GOOD_TEST });
    forge.start({ kind: 'tool', goal: 'A tool that adds two numbers together', name: 'calc' });
    await settle(forge);
    const r = forge.status();
    expect(r?.error).toBeUndefined();
    expect(r?.state).toBe('passed');
    expect(r?.tool?.tools.map((t) => t.name)).toEqual(['add_numbers', 'read_path']);
    expect(await forge.installTool()).toBe('added');
    expect(added[0]).toMatchObject({
      name: 'forge-calc',
      trustLevel: 'experimental',
      defaultTier: 'CONFIRM',
    });
    expect(added[0]?.args[0]).toBe('--permission');
    await expect(forge.installTool()).rejects.toThrow(/already installed/);

    // Installed, the tool really runs in the sandbox: it can't read a file outside its folder.
    const server = added[0]!;
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: server.command!,
        args: server.args,
      }),
    );
    const sum = await client.callTool({ name: 'add_numbers', arguments: { a: 20, b: 22 } });
    expect(JSON.stringify(sum.content)).toContain('42');
    const leak = await client.callTool({ name: 'read_path', arguments: { path: outside } });
    expect(leak.isError).toBe(true);
    expect(JSON.stringify(leak.content)).not.toContain('secret');
    await client.close();
    expect(updated).toEqual([]);
  }, 120_000);

  it('the guard stops sockets, local addresses and Node internals even if code gets past the checks', async () => {
    // Written straight into a folder, skipping the static checks, to test the runtime boundary itself.
    const dir = join(root, 'escape');
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, GUARD_FILE), TOOL_GUARD);
    writeFileSync(join(dir, RUNTIME_FILE), TOOL_RUNTIME);
    const attempt = (name: string, body: string) =>
      `{ name: '${name}', description: 'escape attempt', inputSchema: { type: 'object' }, async run() { try { return String(await (async () => { ${body} })()); } catch (e) { return 'BLOCKED ' + e.message; } } }`;
    writeFileSync(
      join(dir, 'tool.mjs'),
      `export const tools = [
        ${attempt('net', "return (await import('node:' + 'net')).connect")},
        ${attempt('bare', "return (await import('n' + 'et')).connect")},
        ${attempt('builtin', "return process.getBuiltinModule('node:net')")},
        ${attempt('loopback', "return (await fetch('https://127.0.0.1:9/')).status")},
        ${attempt('plainhttp', "return (await fetch('http://example.com/')).status")},
        ${attempt('localhost', "return (await fetch('https://localhost/')).status")},
        ${attempt('ws', 'return typeof WebSocket')},
        ${attempt('child', "return (await import('node:child_process')).execSync('whoami')")},
      ];`,
    );
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StdioClientTransport(serverCommand(nodeExe, dir)));
    const out: Record<string, string> = {};
    for (const name of [
      'net',
      'bare',
      'builtin',
      'loopback',
      'plainhttp',
      'localhost',
      'ws',
      'child',
    ]) {
      const r = await client.callTool({ name, arguments: {} });
      out[name] = JSON.stringify(r.content);
    }
    await client.close();
    for (const name of ['net', 'bare', 'builtin', 'loopback', 'plainhttp', 'localhost', 'child'])
      expect(out[name], name).toContain('BLOCKED');
    expect(out['ws']).toContain('undefined');
  }, 60_000);

  it('rejects a tool that imports child_process before running it', async () => {
    const { forge } = setup({
      'tool.mjs': `import { execSync } from 'node:child_process';\n${GOOD_TOOL}`,
      'tool.test.mjs': GOOD_TEST,
    });
    forge.start({ kind: 'tool', goal: 'A tool that adds two numbers together', name: 'bad' });
    await settle(forge);
    expect(forge.status()).toMatchObject({ state: 'failed', error: 'the lint check failed' });
  }, 60_000);

  it('a test that reads outside its folder fails in the sandbox', async () => {
    const { forge } = setup({
      'tool.mjs': GOOD_TOOL,
      'tool.test.mjs': `${GOOD_TEST}\ntest('reads outside', async () => {\n  assert.equal(await tools[1].run({ path: ${JSON.stringify(outside)} }), 'secret');\n});\n`,
    });
    forge.start({ kind: 'tool', goal: 'A tool that adds two numbers together', name: 'leaky' });
    await settle(forge);
    expect(forge.status()).toMatchObject({ state: 'failed', error: 'the unit check failed' });
  }, 60_000);

  it('a tool without tests, or with a package.json, fails the review', async () => {
    const { forge } = setup({ 'tool.mjs': GOOD_TOOL, 'package.json': '{}' });
    forge.start({ kind: 'tool', goal: 'A tool that adds two numbers together', name: 'untested' });
    await settle(forge);
    const r = forge.status();
    expect(r?.error).toBe('the review check failed');
    expect(r?.report?.results[0]?.tail).toContain('package.json');
    expect(r?.report?.results[0]?.tail).toContain('tool.test.mjs: missing');
  }, 60_000);
});
