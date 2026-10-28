import { realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Forge phase F3 (docs/Forge.md): a self-built tool is one ES module, `tool.mjs`, run by this small
 * MCP server. Forge writes the runtime and the guard into the tool's folder itself (the boss's
 * copies are replaced) and starts it with Node's permission model: read only its own folder, write
 * only `./data`, no child processes, workers, addons or WASI. Node 24 has no network permission, so
 * the guard (loaded before any tool code, also for its tests) does that part: only the built-ins on
 * the list can be imported, `fetch` reaches only public https addresses, and `WebSocket`,
 * `process.getBuiltinModule` and `process.binding` are gone. MCP over stdio is newline-delimited
 * JSON-RPC, so the runtime needs nothing but `node:readline`.
 */

export const RUNTIME_FILE = '_runtime.mjs';
export const GUARD_FILE = '_guard.mjs';
export const TOOL_FILE = 'tool.mjs';
export const TEST_FILE = 'tool.test.mjs';
export const DATA_DIR = 'data';

/** The Node built-ins a tool may import (`node:` prefix): no processes, sockets, DNS, VM or loaders. */
export const TOOL_BUILTINS: readonly string[] = [
  'assert',
  'assert/strict',
  'buffer',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'os',
  'path',
  'perf_hooks',
  'querystring',
  'readline',
  'stream',
  'stream/promises',
  'string_decoder',
  'test',
  'timers',
  'timers/promises',
  'url',
  'util',
  'zlib',
];

export const TOOL_GUARD = `// Jarvis Forge tool guard. Written by Jarvis on every build and install: edits are overwritten.
// Loaded before any tool code: what Node's permission model can't limit on this Node version.
import { registerHooks } from 'node:module';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const ALLOWED = new Set(${JSON.stringify(TOOL_BUILTINS)});
registerHooks({
  resolve(specifier, context, next) {
    const builtin = specifier.startsWith('node:') ? specifier.slice(5) : null;
    const ok = builtin !== null ? ALLOWED.has(builtin) : /^\\.\\.?\\//.test(specifier) || specifier.startsWith('file:');
    if (!ok) throw new Error('A Jarvis tool may not import "' + specifier + '".');
    return next(specifier, context);
  },
});
const blocked = (what) => () => {
  throw new Error(what + ' is not available to Jarvis tools.');
};
process.getBuiltinModule = blocked('process.getBuiltinModule');
process.binding = blocked('process.binding');
process._linkedBinding = blocked('process._linkedBinding');
delete globalThis.WebSocket;
delete globalThis.EventSource;

function isPrivate(ip) {
  const v4 = /^(?:::ffff:)?(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)$/i.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('::ffff:');
}

async function check(url) {
  if (url.protocol !== 'https:') throw new Error('Jarvis tools may only fetch https:// addresses.');
  const host = url.hostname.replace(/^\\[|\\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    throw new Error('Jarvis tools may not reach this PC or the home network.');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivate(a.address)))
    throw new Error('Jarvis tools may not reach this PC or the home network.');
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function fetch(input, init) {
  let req = new Request(input, { ...init, redirect: 'manual' });
  for (let hop = 0; hop < 5; hop++) {
    await check(new URL(req.url));
    const res = await realFetch(req);
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    req = new Request(new URL(location, req.url), {
      method: res.status === 303 ? 'GET' : req.method,
      headers: req.headers,
      redirect: 'manual',
    });
  }
  throw new Error('Too many redirects.');
};
`;

export const TOOL_RUNTIME = `// Jarvis Forge tool runtime. Written by Jarvis on every build and install: edits are overwritten.
import './_guard.mjs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.argv[2];
const dataDir = join(dir, 'data');
const MAX_TEXT = 50000;
const CALL_TIMEOUT_MS = 30000;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');

let tools = [];
try {
  ({ tools } = await import(pathToFileURL(join(dir, 'tool.mjs')).href));
} catch (e) {
  process.stderr.write('tool.mjs did not load: ' + (e && e.message ? e.message : String(e)) + '\\n');
  process.exit(1);
}
const byName = new Map(tools.map((t) => [t.name, t]));
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? '');

async function call(tool, args) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out after 30 s')), CALL_TIMEOUT_MS);
  });
  try {
    return asText(await Promise.race([tool.run(args ?? {}, { dataDir }), timeout])).slice(0, MAX_TEXT);
  } finally {
    clearTimeout(timer);
  }
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id === undefined || id === null) return;
  const reply = (result) => send({ jsonrpc: '2.0', id, result });
  if (method === 'initialize')
    return reply({
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'jarvis-forge-tool', version: '1.0.0' },
    });
  if (method === 'ping') return reply({});
  if (method === 'tools/list')
    return reply({
      tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
  if (method === 'tools/call') {
    const tool = byName.get(params && params.name);
    if (!tool) return reply({ content: [{ type: 'text', text: 'Unknown tool.' }], isError: true });
    try {
      return reply({ content: [{ type: 'text', text: await call(tool, params.arguments) }] });
    } catch (e) {
      return reply({ content: [{ type: 'text', text: e && e.message ? e.message : String(e) }], isError: true });
    }
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
});
`;

/**
 * The sandbox flags for one tool folder (Node's permission model). Node compares the real long path
 * (an 8.3 name like TEJAN~1 would not match), and its lists split on "," and expand "*", so a folder
 * name with either is refused rather than widening the grant.
 */
export function sandboxArgs(dir: string): string[] {
  const real = realpathSync.native(dir);
  if (/[,*]/.test(real)) throw new Error(`Tool folders can't contain "," or "*": ${real}`);
  return ['--permission', `--allow-fs-read=${real}`, `--allow-fs-write=${join(real, DATA_DIR)}`];
}

/** `--permission` is stable from Node 22.13 / 23.5, and `--test-isolation` from 22.14 / 23.6. */
export function nodeRunsTools(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return (major === 22 && minor >= 14) || (major === 23 && minor >= 6) || major >= 24;
}

export function toolRules(name: string): string {
  return `

# Jarvis Forge: build a tool
You are building a new tool for JARVIS, called "${name}", in this folder (your working directory). Sir asked for one ability; build it completely.

How a tool works:
- ${TOOL_FILE} is an ES module that exports \`tools\`: an array of { name, description, inputSchema, run }.
  - name: snake_case, 2–40 characters, starting with a letter.
  - description: for an AI deciding when to use it: what it does, when to use it, what it returns (at most about 80 words).
  - inputSchema: a JSON Schema object ({ type: 'object', properties, required }).
  - run(input, { dataDir }): async; returns a string or a JSON-serialisable value. dataDir is the only folder it may write to.
- ${TEST_FILE} tests every tool with node:test and node:assert (import { tools } from './${TOOL_FILE}'). Never call the network in tests: replace globalThis.fetch with a stub that returns a sample response.
- It runs with Node's permission model: it can read only this folder and write only ./${DATA_DIR}; it cannot start programs, workers or addons. Use only node: built-in modules and the global fetch. No npm packages, no package.json, no child_process, worker_threads, cluster, vm or inspector.
- Keys or passwords never go in the code. If the ability needs an account, say so in your summary instead.
- Do not edit ${RUNTIME_FILE}: Forge owns it.

Checks (run_check): "test" runs ${TEST_FILE} in the sandbox, "typecheck" checks the syntax of every .mjs file, "lint" checks the imports. All three must pass before you finish.

Finish with a short summary for Sir: what each tool does, an example of asking for it, and its limits.`;
}
