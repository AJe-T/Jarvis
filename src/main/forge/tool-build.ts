import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerInput, McpServerView } from '@shared/ipc-contract';
import { runProcess } from '../lib/process';
import type { GateReport, GateResult } from './gates';
import type { Finding } from './protected';
import {
  DATA_DIR,
  GUARD_FILE,
  RUNTIME_FILE,
  sandboxArgs,
  TEST_FILE,
  TOOL_BUILTINS,
  TOOL_FILE,
  TOOL_GUARD,
  TOOL_RUNTIME,
} from './tool-runtime';

/**
 * Forge phase F3: build, check and install a self-built tool (docs/Forge.md §2 L2). A build happens
 * in its own folder (`forge/tool-builds/<name>-<time>`); a passed build is copied to
 * `forge/tools/<name>` and registered as an MCP connection `forge-<name>` (experimental, CONFIRM),
 * so Settings → Connections switches it on or off or removes it like any other.
 *
 * The boundary is Node's permission model plus the guard (tool-runtime.ts). The import check here
 * only gives the boss early, readable feedback; it is not a security boundary.
 */

/** Short enough for the connection name `forge-<name>` (MCP names are at most 31 characters). */
export const TOOL_NAME_RE = /^[a-z][a-z0-9-]{1,23}$/;
const TOOL_FN_RE = /^[a-z][a-z0-9_]{1,40}$/;
const ALLOWED_FILE = /^\w[\w.-]*\.(?:mjs|json|md)$/i;
const FORGE_FILES = new Set([RUNTIME_FILE, GUARD_FILE]);
const MAX_FILES = 20;
const MAX_BYTES = 500_000;
const OUT = 6000;
const MIN = 60_000;
const BUILTINS = new Set(TOOL_BUILTINS);
/** `import x from '…'`, `import '…'` and re-exports `export * from '…'`. */
const IMPORT_RE = /\b(?:import|export)\s*(?:[\w*{}\s,]+?from\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*(?:\/\*[^]*?\*\/\s*)*\(/;
const FORBIDDEN =
  /\brequire\s*\(|\bprocess\s*\.\s*(?:binding|dlopen|_linkedBinding|getBuiltinModule)\b|\beval\s*\(|\bnew\s+Function\s*\(|\.constructor\s*\(/;

export interface ToolInfo {
  name: string;
  description: string;
}

const result = (id: GateResult['id'], ok: boolean, tail: string, ms = 0): GateResult => ({
  id,
  ok,
  ms,
  tail,
});

/** Forge's own runtime and guard: rewritten before every check and install, so edits never run. */
function writeForgeFiles(dir: string): void {
  writeFileSync(join(dir, GUARD_FILE), TOOL_GUARD, 'utf8');
  writeFileSync(join(dir, RUNTIME_FILE), TOOL_RUNTIME, 'utf8');
}

/** A fresh build folder: the installed version's files (not its data) when updating, plus Forge's files. */
export function prepareToolBuild(forgeDir: string, name: string, stamp: string): string {
  const dir = join(forgeDir, 'tool-builds', `${name}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const installed = join(forgeDir, 'tools', name);
  if (existsSync(installed))
    for (const f of readdirSync(installed))
      if (f !== DATA_DIR && !FORGE_FILES.has(f) && lstatSync(join(installed, f)).isFile())
        cpSync(join(installed, f), join(dir, f));
  mkdirSync(join(dir, DATA_DIR), { recursive: true });
  writeForgeFiles(dir);
  return dir;
}

/** Only small, plain source and text files at the top level; tool.mjs and its tests must be there. */
export function reviewToolFiles(dir: string): Finding[] {
  const findings: Finding[] = [];
  const block = (path: string, problem: string): void => {
    findings.push({ path, severity: 'block', problem });
  };
  let bytes = 0;
  const entries = readdirSync(dir).filter((f) => f !== DATA_DIR);
  if (entries.length > MAX_FILES) block('.', `more than ${MAX_FILES} files`);
  for (const f of entries) {
    // lstat: a link is refused, never followed.
    const st = lstatSync(join(dir, f));
    if (st.isSymbolicLink()) block(f, 'links are not allowed');
    else if (st.isDirectory()) block(f, 'folders are not allowed (only ./data)');
    else if (!ALLOWED_FILE.test(f) || f.toLowerCase() === 'package.json')
      block(f, 'only .mjs, .json and .md files, and no package.json');
    else if (st.nlink > 1) block(f, 'hard-linked files are not allowed');
    else bytes += st.size;
  }
  if (lstatSync(join(dir, DATA_DIR)).isSymbolicLink()) block(DATA_DIR, 'links are not allowed');
  if (bytes > MAX_BYTES) block('.', 'more than 500 KB of files');
  for (const f of [TOOL_FILE, TEST_FILE]) if (!entries.includes(f)) block(f, 'missing');
  if (entries.includes(TEST_FILE) && !/\b(?:it|test)\s*\(/.test(read(dir, TEST_FILE)))
    block(TEST_FILE, 'has no test');
  return findings;
}

const read = (dir: string, f: string): string => readFileSync(join(dir, f), 'utf8');
const sources = (dir: string): string[] =>
  readdirSync(dir).filter((f) => f.endsWith('.mjs') && !FORGE_FILES.has(f));

/** Early feedback for the boss: imports must be `node:` built-ins on the list or `./file.mjs`. */
export function checkImports(dir: string): string[] {
  const problems: string[] = [];
  for (const f of sources(dir)) {
    const text = read(dir, f);
    if (DYNAMIC_IMPORT.test(text)) problems.push(`${f}: dynamic import()`);
    if (FORBIDDEN.test(text))
      problems.push(`${f}: require, eval, Function constructors or process internals`);
    for (const [, spec = ''] of text.matchAll(IMPORT_RE)) {
      if (/^\.\/[\w.-]+\.mjs$/.test(spec)) continue;
      const builtin = spec.startsWith('node:') ? spec.slice(5) : null;
      if (builtin === null) problems.push(`${f}: "${spec}" (only node: built-ins and ./file.mjs)`);
      else if (!BUILTINS.has(builtin)) problems.push(`${f}: "${spec}" is not allowed in a tool`);
    }
  }
  return problems;
}

/** What a tool's checks may see of the environment: enough for Node to start on Windows. */
export function toolEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  const byLower = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of ['PATH', 'SystemRoot', 'SystemDrive', 'windir', 'TEMP', 'TMP']) {
    const v = byLower.get(k.toLowerCase());
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export interface ToolRunner {
  nodeExe: string;
  run(
    args: string[],
    opts: { timeoutMs: number; signal: AbortSignal },
  ): Promise<{ code: number | null; out: string }>;
}

export function createToolRunner(nodeExe: string, dir: string): ToolRunner {
  return {
    nodeExe,
    // The real long path: relative files resolve from here, and the sandbox only allows that form.
    run: (args, opts) =>
      runProcess(nodeExe, args, {
        cwd: realpathSync.native(dir),
        env: toolEnv(),
        maxOut: OUT,
        ...opts,
      }),
  };
}

/** The boss's run_check for a tool: test = the tests in the sandbox, typecheck = syntax, lint = imports. */
export async function toolCheck(
  runner: ToolRunner,
  dir: string,
  check: 'typecheck' | 'lint' | 'test',
  signal: AbortSignal,
): Promise<GateResult> {
  const start = Date.now();
  if (check === 'lint') {
    const problems = checkImports(dir);
    return result('lint', problems.length === 0, problems.join('\n') || 'Imports are fine.');
  }
  writeForgeFiles(dir);
  const sandbox = sandboxArgs(dir);
  if (check === 'typecheck') {
    for (const f of sources(dir)) {
      const r = await runner.run([...sandbox, '--check', `./${f}`], { timeoutMs: MIN, signal });
      if (r.code !== 0) return result('typecheck', false, r.out, Date.now() - start);
    }
    return result('typecheck', true, 'Syntax is fine.', Date.now() - start);
  }
  if (!existsSync(join(dir, TEST_FILE))) return result('unit', false, `${TEST_FILE} is missing.`);
  // The guard loads first, so the tests run under the same limits as the installed tool.
  const guard = pathToFileURL(join(realpathSync.native(dir), GUARD_FILE)).href;
  const r = await runner.run(
    [...sandbox, `--import=${guard}`, '--test', '--test-isolation=none', `./${TEST_FILE}`],
    { timeoutMs: 2 * MIN, signal },
  );
  return result('unit', r.code === 0, r.out, Date.now() - start);
}

/** The command and arguments that start a tool folder as an MCP server. */
export function serverCommand(nodeExe: string, dir: string): { command: string; args: string[] } {
  const real = realpathSync.native(dir);
  return { command: nodeExe, args: [...sandboxArgs(real), join(real, RUNTIME_FILE), real] };
}

/** Starts the tool like Jarvis will and lists its tools over MCP. */
export async function handshake(nodeExe: string, dir: string): Promise<ToolInfo[]> {
  const transport = new StdioClientTransport({
    ...serverCommand(nodeExe, dir),
    env: toolEnv(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'jarvis-forge', version: '1.0.0' });
  try {
    await client.connect(transport, { timeout: 20_000 });
    const { tools } = await client.listTools(undefined, { timeout: 10_000 });
    return tools.map((t) => ({ name: t.name, description: t.description ?? '' }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

function checkToolInfos(tools: ToolInfo[]): string[] {
  if (tools.length === 0) return ['tool.mjs exports no tools'];
  return tools.flatMap((t) => [
    ...(TOOL_FN_RE.test(t.name) ? [] : [`"${t.name}" is not a snake_case name`]),
    ...(t.description.trim().length >= 10 ? [] : [`"${t.name}" has no real description`]),
  ]);
}

/** Every check of a tool build, in order; stops at the first failure. */
export async function runToolGates(
  runner: ToolRunner,
  dir: string,
  signal: AbortSignal,
  onGate?: (id: string) => void,
): Promise<GateReport & { tools: ToolInfo[] }> {
  writeForgeFiles(dir);
  const findings = reviewToolFiles(dir);
  const results: GateResult[] = [
    result(
      'review',
      findings.length === 0,
      findings.map((f) => `BLOCK ${f.path}: ${f.problem}`).join('\n'),
    ),
  ];
  const done = (ok: boolean, tools: ToolInfo[] = []) => ({ ok, results, findings, tools });
  if (findings.length) return done(false);
  for (const check of ['lint', 'typecheck', 'test'] as const) {
    if (signal.aborted) return done(false);
    onGate?.(check);
    const r = await toolCheck(runner, dir, check, signal);
    results.push(r);
    if (!r.ok) return done(false);
  }
  onGate?.('load');
  try {
    const tools = await handshake(runner.nodeExe, dir);
    const problems = checkToolInfos(tools);
    results.push(
      result('build', problems.length === 0, problems.join('\n') || 'Loads and lists its tools.'),
    );
    return done(problems.length === 0, tools);
  } catch (err) {
    results.push(
      result(
        'build',
        false,
        `The tool did not start: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return done(false);
  }
}

export interface McpAccess {
  list(): McpServerView[];
  add(input: McpServerInput): Promise<unknown>;
  update(id: string, patch: Partial<McpServerInput>): Promise<void>;
}

export const connectionName = (tool: string): string => `forge-${tool}`;

/** Copies a passed build into `forge/tools/<name>` (keeping its data) and registers or updates it. */
export async function installTool(input: {
  forgeDir: string;
  buildDir: string;
  name: string;
  nodeExe: string;
  mcp: McpAccess;
}): Promise<'added' | 'updated'> {
  const dir = join(input.forgeDir, 'tools', input.name);
  const name = connectionName(input.name);
  const existing = input.mcp.list().find((s) => s.name === name);
  // Only a connection Forge made for this folder is replaced, never one Sir set up by hand.
  if (
    existing &&
    !existing.args.some((a) =>
      a.toLowerCase().endsWith(join('tools', input.name, RUNTIME_FILE).toLowerCase()),
    )
  )
    throw new Error(
      `A connection called "${name}" already exists and was not made by Forge. Rename the tool.`,
    );
  if (reviewToolFiles(input.buildDir).length)
    throw new Error('The build folder changed since it was checked.');
  mkdirSync(join(dir, DATA_DIR), { recursive: true });
  for (const f of readdirSync(dir))
    if (f !== DATA_DIR) rmSync(join(dir, f), { recursive: true, force: true });
  for (const f of readdirSync(input.buildDir))
    if (f !== DATA_DIR && !FORGE_FILES.has(f)) cpSync(join(input.buildDir, f), join(dir, f));
  writeForgeFiles(dir);
  const { command, args } = serverCommand(input.nodeExe, dir);
  if (existing) {
    await input.mcp.update(existing.id, { command, args });
    return 'updated';
  }
  await input.mcp.add({
    name,
    transport: 'stdio',
    command,
    args,
    envSecrets: {},
    trustLevel: 'experimental',
    defaultTier: 'CONFIRM',
    toolOverrides: {},
    enabled: true,
  });
  return 'added';
}
