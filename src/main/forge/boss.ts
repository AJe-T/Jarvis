import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CanUseTool, McpServerConfig, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { baseOptions, requirePath, type ClaudeCodeRuntime } from '../llm/claude-code';
import { forgeEnv } from './env';
import { describeReport, type GateResult } from './gates';
import { isProtected, normalizePath, PROTECTED_PATHS } from './protected';

/**
 * The Forge boss (docs/Forge.md F1): Sir's own Claude Code, run headless through the Agent SDK in
 * Forge's clone. It gets file tools only, no shell: checks run through Forge's own `run_check`
 * tool (argument arrays, fixed commands). Every file tool call passes `forgePermission`, so it can't
 * read or write outside the clone, touch .git or node_modules, or change a protected file Sir
 * didn't name.
 */

const SERVER = 'forge';
const PREFIX = `mcp__${SERVER}__`;
export const BOSS_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'TodoWrite'];
const NEVER_TOOLS = [
  'Bash',
  'PowerShell',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
  'NotebookEdit',
  'MultiEdit',
];
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const WRITE_TOOLS = new Set(['Edit', 'Write']);
const MAX_TURNS = 300;
/** Longer than the slowest check (the full unit suite). */
const CHECK_TIMEOUT_MS = 25 * 60_000;
const NO_WRITE = ['.git/', 'node_modules/'];

/** Where a file tool points: `file_path` (Read, Edit, Write) or `path` (Glob, Grep; default the repo). */
function targetOf(input: Record<string, unknown>): string | null {
  const p = input['file_path'] ?? input['path'];
  return typeof p === 'string' ? p : null;
}

/**
 * Names Windows maps onto another file: 8.3 short names (SECURI~1), alternate data streams
 * (a.ts:x), trailing dots or spaces (a.ts. is a.ts) and devices (CON, NUL, COM1…). Refused, so a
 * protected file can't be reached under a second name.
 */
const ALIAS_SEGMENT = /~\d|[:<>|"?*]|[. ]$|^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;
/** Claude Code expands ~ to the home folder (and a shell would expand $VAR, %VAR%): never relative. */
const EXPANDS = /^[~$%]/;

/** Follows junctions and symlinks: the nearest existing folder of `abs` must really be in `root`. */
function reallyInside(root: string, abs: string): boolean {
  let p = abs;
  while (!existsSync(p)) {
    const up = dirname(p);
    if (up === p) return false;
    p = up;
  }
  const rel = relative(realpathSync.native(root), realpathSync.native(p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The path relative to the repo, or null when it is outside it (or names a file another way). */
export function insideRepo(repoDir: string, p: string): string | null {
  if (EXPANDS.test(p.trim())) return null;
  const abs = resolve(repoDir, p);
  const rel = relative(resolve(repoDir), abs);
  if (rel === '') return '';
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  const segments = rel.split(/[\\/]/);
  if (segments.some((s) => ALIAS_SEGMENT.test(s))) return null;
  if (!reallyInside(repoDir, abs)) return null;
  return segments.join('/');
}

/** Glob's pattern and Grep's file filter are paths too: not absolute, no "..", no ~. */
const escapesRepo = (pattern: unknown): boolean =>
  typeof pattern === 'string' &&
  (isAbsolute(pattern) ||
    EXPANDS.test(pattern.trim()) ||
    /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(pattern));

/** The only gate on the boss's tool calls. */
export function forgePermission(repoDir: string, approved: readonly string[]): CanUseTool {
  return (name, input) => {
    const allow = Promise.resolve({ behavior: 'allow' as const, updatedInput: input });
    const deny = (message: string): ReturnType<CanUseTool> =>
      Promise.resolve({ behavior: 'deny', message });
    if (name.startsWith(PREFIX) || name === 'TodoWrite') return allow;
    if (!READ_TOOLS.has(name) && !WRITE_TOOLS.has(name))
      return deny(`${name} is not available in Forge. Use run_check to run checks.`);
    if (escapesRepo(name === 'Glob' ? input['pattern'] : input['glob']))
      return deny('Search patterns must stay inside the Forge repository.');
    const target = targetOf(input);
    if (target === null) return READ_TOOLS.has(name) ? allow : deny('No file path given.');
    const rel = insideRepo(repoDir, target);
    if (rel === null) return deny(`${target} is outside the Forge repository.`);
    const p = normalizePath(rel);
    if (p === '.git' || p.startsWith('.git/')) return deny('.git is not available in Forge.');
    if (READ_TOOLS.has(name)) return allow;
    if (NO_WRITE.some((d) => p === d.slice(0, -1) || p.startsWith(d)))
      return deny(`${rel} may not be changed.`);
    if (isProtected(rel, approved))
      return deny(
        `${rel} is a protected file (Forge safety rules). Do not work around this: finish what you can and say in your summary which protected file needs Sir's approval and why.`,
      );
    return allow;
  };
}

export type CheckFn = (
  check: 'typecheck' | 'lint' | 'test',
  files: string[],
) => Promise<GateResult>;

/** Phase F4: hands a small edit to a free AI (forge/workers.ts). */
export type DelegateFn = (raw: unknown) => Promise<{ ok: boolean; text: string }>;

const DELEGATE_TOOL = {
  name: 'delegate_edit',
  description:
    'Hand a small, exact edit of 1–3 files to a free AI, to save Claude usage. Write the task completely (what to change, signatures, behaviour, edge cases) and name the files (existing or new); add read-only context such as related types if needed. The free AI writes the files; you MUST then Read them, fix what is wrong and run the checks. If it says the free AIs did not do it, do the edit yourself.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      task: { type: 'string', maxLength: 6000 },
      files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
      context: { type: 'string', maxLength: 4000 },
    },
    required: ['task', 'files'],
  },
};

/** In-process MCP server with Forge's tools for the boss. */
function createForgeServer(
  check: CheckFn,
  changedFiles: () => Promise<string>,
  delegate?: DelegateFn,
): McpServer {
  const mcp = new McpServer({ name: SERVER, version: '1.0.0' }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...(delegate ? [DELEGATE_TOOL] : []),
      {
        name: 'run_check',
        description:
          'Run a project check in the repository and get its result and the end of its output. "typecheck" and "lint" check the whole project; "test" runs the tests related to the files you name (or the full unit suite when you name none, which takes several minutes).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            check: { type: 'string', enum: ['typecheck', 'lint', 'test'] },
            files: { type: 'array', items: { type: 'string' }, maxItems: 50 },
          },
          required: ['check'],
        },
      },
      {
        name: 'changed_files',
        description: 'List the files you have changed so far (git status).',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ],
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments ?? {};
    if (req.params.name === 'changed_files')
      return { content: [{ type: 'text', text: (await changedFiles()) || 'No changes yet.' }] };
    if (req.params.name === 'delegate_edit' && delegate) {
      const r = await delegate(args);
      return { content: [{ type: 'text', text: r.text }], ...(r.ok ? {} : { isError: true }) };
    }
    const c = args['check'];
    if (req.params.name !== 'run_check' || (c !== 'typecheck' && c !== 'lint' && c !== 'test'))
      return { content: [{ type: 'text', text: 'Unknown tool or check.' }], isError: true };
    const files = Array.isArray(args['files'])
      ? args['files'].filter((f): f is string => typeof f === 'string').slice(0, 50)
      : [];
    const r = await check(c, files);
    return {
      content: [{ type: 'text', text: describeReport({ ok: r.ok, results: [r], findings: [] }) }],
      ...(r.ok ? {} : { isError: true }),
    };
  });
  return mcp;
}

/** Phase F4: how the boss should use the free workers. */
export const DELEGATE_RULE = `
- Save Claude usage: for each well-defined edit of 1–3 files (a new module from a clear spec, a test file, a mechanical change), try delegate_edit first and do it yourself only when it says the free AIs did not. Plan, review and fix yourself; always Read what a free AI wrote before relying on it.`;

export function bossRules(
  approved: readonly string[],
  repoRules: string,
  delegate = false,
): string {
  return `

# Jarvis Forge
You are working for JARVIS on its own source code, in Forge's private copy of the repository (your working directory). Sir asked for one change; build it completely.

Rules:
- Work only in this repository. You have file tools and Forge tools: run_check (typecheck, lint, tests), changed_files${delegate ? ' and delegate_edit' : ''}. There is no shell.${delegate ? DELEGATE_RULE : ''}
- Test first: write or update the tests for the change, then the code. Before you finish, run_check typecheck, lint and test on the files you changed, and fix every failure.
- Never delete, skip (.skip, .todo, .only, xit) or weaken a test to make it pass, and never change test, lint or type settings. Forge rejects such changes.
- Protected files (Forge safety rules) cannot be changed${approved.length ? `, except the ones Sir approved for this run: ${approved.join(', ')}` : ''}. If the change truly needs another protected file, stop and say which one and why in your summary.
- Do not copy code from other repositories; build our own version from how they work.
- Do not bump the version, build an installer, commit or push: Forge does that after its checks pass.
- Follow the project rules below (CLAUDE.md and conversations/RULES.md), including updating docs/BIBLE.md for the change.
- Finish with a short summary for Sir: what changed (Before/After/Why), which tests cover it, and anything you could not do.

Protected: ${PROTECTED_PATHS.join(', ')}

# Project rules
${repoRules}`;
}

export interface BossResult {
  ok: boolean;
  summary: string;
  costUsd: number;
  turns: number;
}

/** Runs one Forge brief to the end (or until the budget, turn limit or cancel stops it). */
export async function runBoss(input: {
  rt: ClaudeCodeRuntime;
  repoDir: string;
  brief: string;
  rules: string;
  approved: readonly string[];
  budgetUsd: number;
  signal: AbortSignal;
  check: CheckFn;
  changedFiles(): Promise<string>;
  delegate?: DelegateFn;
  onProgress(text: string): void;
}): Promise<BossResult> {
  const path = requirePath(input.rt);
  const query = await input.rt.query();
  const abortController = new AbortController();
  const onAbort = (): void => abortController.abort();
  if (input.signal.aborted) abortController.abort();
  input.signal.addEventListener('abort', onAbort, { once: true });
  const server: McpServerConfig = {
    type: 'sdk',
    name: SERVER,
    instance: createForgeServer(input.check, input.changedFiles, input.delegate),
    timeout: CHECK_TIMEOUT_MS,
  };
  let text = '';
  try {
    for await (const m of query({
      prompt: input.brief,
      options: {
        ...baseOptions(input.rt, path),
        cwd: input.repoDir,
        env: forgeEnv(),
        tools: BOSS_TOOLS,
        // Belt and braces: `tools` already leaves these out.
        disallowedTools: NEVER_TOOLS,
        permissionMode: 'default',
        canUseTool: forgePermission(input.repoDir, input.approved),
        mcpServers: { [SERVER]: server },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: input.rules },
        maxTurns: MAX_TURNS,
        maxBudgetUsd: input.budgetUsd,
        abortController,
      },
    }) as AsyncIterable<SDKMessage>) {
      if (m.type === 'rate_limit_event') input.rt.onRateLimit?.(m.rate_limit_info);
      else if (m.type === 'assistant') {
        text = '';
        for (const b of m.message.content) {
          if (b.type === 'text') text += b.text;
          else if (b.type === 'tool_use') input.onProgress(describeToolUse(b.name, b.input));
        }
      } else if (m.type === 'result') return resultOf(m, text);
    }
  } finally {
    input.signal.removeEventListener('abort', onAbort);
  }
  return { ok: false, summary: 'Claude Code stopped without a result.', costUsd: 0, turns: 0 };
}

const STOP_REASON: Record<string, string> = {
  error_max_turns: 'it reached the turn limit',
  error_max_budget_usd: "it reached this run's budget",
  error_during_execution: 'an error during the run',
};

function resultOf(m: Extract<SDKMessage, { type: 'result' }>, lastText: string): BossResult {
  const base = { costUsd: m.total_cost_usd, turns: m.num_turns };
  if (m.subtype === 'success') return { ...base, ok: !m.is_error, summary: m.result || lastText };
  const reason = `Stopped: ${STOP_REASON[m.subtype] ?? m.subtype}.`;
  return { ...base, ok: false, summary: lastText ? `${reason}\n\n${lastText}` : reason };
}

function describeToolUse(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const target = typeof i['file_path'] === 'string' ? i['file_path'] : '';
  if (name === 'Edit' || name === 'Write') return `Editing ${target}`;
  if (name === 'Read') return `Reading ${target}`;
  if (name === `${PREFIX}run_check`)
    return `Running ${typeof i['check'] === 'string' ? i['check'] : 'a check'}`;
  return name.replace(PREFIX, '');
}
