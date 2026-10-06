import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type {
  Options,
  SDKMessage,
  SDKUserMessage,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';
import { JarvisError } from '../errors';
import type { LlmClient, LlmMessage, LlmRequest, MessageParam } from './types';

/**
 * ADR-010: "Claude subscription" mode. Jarvis drives Sir's own, unmodified Claude Code binary through
 * the official Agent SDK, so requests use the plan Sir signed in to with `claude auth login`.
 * Jarvis never reads, stores or forwards the Claude.ai credentials; Claude Code owns them.
 */
export type QueryFn = typeof sdkQuery;

export interface ClaudeCodeRuntime {
  /** Resolved claude.exe, or null when Claude Code isn't installed. */
  path(): string | null;
  /** Empty working folder Jarvis owns, so no project CLAUDE.md or settings are picked up. */
  cwd: string;
  query(): Promise<QueryFn>;
}

export interface ClaudeCodeStatus {
  found: boolean;
  path: string | null;
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
  error?: string;
}

/**
 * The native installer's location, then PATH. Deliberately not a setting: a path the renderer could
 * change would let a compromised UI pick which program Jarvis runs.
 */
export function findClaudeCode(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const candidates = [
    ...(env['USERPROFILE'] ? [join(env['USERPROFILE'], '.local', 'bin', 'claude.exe')] : []),
    ...(env['PATH'] ?? env['Path'] ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => join(dir, 'claude.exe')),
  ];
  return candidates.find((p) => exists(p)) ?? null;
}

/** Keeps only what Jarvis needs from `claude auth status --json` (never the email or org). */
export function parseAuthStatus(stdout: string): Omit<ClaudeCodeStatus, 'found' | 'path'> {
  try {
    const d = JSON.parse(stdout) as Record<string, unknown>;
    return {
      loggedIn: d['loggedIn'] === true,
      ...(typeof d['authMethod'] === 'string' ? { authMethod: d['authMethod'] } : {}),
      ...(typeof d['subscriptionType'] === 'string'
        ? { subscriptionType: d['subscriptionType'] }
        : {}),
    };
  } catch {
    return { loggedIn: false, error: 'Claude Code returned an unexpected status.' };
  }
}

export function claudeCodeStatus(path: string | null): Promise<ClaudeCodeStatus> {
  if (!path) return Promise.resolve({ found: false, path: null, loggedIn: false });
  return new Promise((resolve) => {
    execFile(
      path,
      ['auth', 'status', '--json'],
      { timeout: 15_000, windowsHide: true, env: sdkEnv() },
      (err, stdout) => {
        // `auth status` exits non-zero when signed out but still prints JSON.
        const parsed = parseAuthStatus(stdout);
        resolve({
          found: true,
          path,
          ...parsed,
          ...(err && !stdout ? { error: 'Could not run Claude Code.' } : {}),
        });
      },
    );
  });
}

/** Opens Claude Code's own sign-in in a console window; the browser flow is Anthropic's. */
export function openClaudeLogin(path: string): void {
  spawn(path, ['auth', 'login', '--claudeai'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: sdkEnv(),
  }).unref();
}

/** An API key in the environment would silently switch Claude Code to API billing. */
export function sdkEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ELECTRON_RUN_AS_NODE'])
    delete env[k];
  return env;
}

/** Options every Jarvis call uses: nothing from ~/.claude (hooks, plugins, MCP, CLAUDE.md) and no built-in tools. */
export function baseOptions(rt: ClaudeCodeRuntime, path: string): Options {
  return {
    pathToClaudeCodeExecutable: path,
    cwd: rt.cwd,
    env: sdkEnv(),
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    tools: [],
  };
}

export function requirePath(rt: ClaudeCodeRuntime): string {
  const path = rt.path();
  if (!path)
    throw new JarvisError(
      'LLM_NO_KEY',
      'claude.exe not found',
      'Claude Code is not installed. Install it, sign in, then choose "Claude subscription" again in Settings → Models & budget.',
    );
  return path;
}

const SIGN_IN =
  'Claude Code is not signed in. Open Settings → Models & budget and choose "Sign in with Claude".';

/** Maps SDK assistant-message errors and result errors to Jarvis errors Sir can act on. */
export function claudeCodeError(
  kind: string | undefined,
  detail: string,
  model: string,
): JarvisError {
  switch (kind) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return new JarvisError('LLM_AUTH', detail, SIGN_IN);
    case 'rate_limit':
      return new JarvisError(
        'LLM_OVERLOADED',
        detail,
        "You've reached your Claude plan's usage limit for now. Try again later, or switch to an API key in Settings.",
      );
    case 'overloaded':
    case 'server_error':
      return new JarvisError(
        'LLM_OVERLOADED',
        detail,
        'Claude is busy right now. Please try again.',
      );
    case 'model_not_found':
      return new JarvisError(
        'LLM_BAD_REQUEST',
        detail,
        `Your Claude plan can't use ${model}. Pick another model in Settings → Models & budget.`,
      );
    case 'billing_error':
    case 'account_on_hold':
      return new JarvisError('LLM_AUTH', detail, `Claude says: ${detail}`);
    default:
      return new JarvisError('LLM_BAD_REQUEST', detail, `Claude Code failed: ${detail}`);
  }
}

export function systemText(system: LlmRequest['system']): string {
  if (!system) return '';
  return typeof system === 'string' ? system : system.map((b) => b.text).join('\n\n');
}

type Block = { type: string; text?: string; name?: string; input?: unknown; content?: unknown };

function blockText(b: Block): string {
  switch (b.type) {
    case 'text':
      return b.text ?? '';
    case 'tool_use':
      return `[Jarvis used ${b.name ?? 'a tool'} ${JSON.stringify(b.input ?? {})}]`;
    case 'tool_result': {
      const c = b.content;
      const text =
        typeof c === 'string' ? c : Array.isArray(c) ? (c as Block[]).map(blockText).join(' ') : '';
      return `[Result: ${text.length > 600 ? `${text.slice(0, 600)}…` : text}]`;
    }
    case 'image':
      return '[image]';
    case 'document':
      return '[document]';
    default:
      return '';
  }
}

/** Earlier turns as plain text: the subscription path is stateless (persistSession: false). */
export function renderTranscript(messages: MessageParam[]): string {
  return messages
    .map((m) => {
      const blocks: Block[] =
        typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
      const text = blocks.map(blockText).filter(Boolean).join('\n').trim();
      if (!text) return '';
      const isToolResult = blocks.every((b) => b.type === 'tool_result');
      return `${m.role === 'assistant' || isToolResult ? 'Jarvis' : 'Sir'}: ${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** One SDK user message: the transcript so far, then the latest user content (images kept). */
export async function* promptFor(messages: MessageParam[]): AsyncGenerator<SDKUserMessage> {
  const last = messages.at(-1);
  const earlier = last?.role === 'user' ? messages.slice(0, -1) : messages;
  const latest =
    last?.role === 'user'
      ? typeof last.content === 'string'
        ? [{ type: 'text' as const, text: last.content }]
        : last.content
      : [];
  const transcript = renderTranscript(earlier);
  const content = [
    ...(transcript
      ? [
          {
            type: 'text' as const,
            text: `<conversation_so_far>\n${transcript}\n</conversation_so_far>\n\nSir's new message:`,
          },
        ]
      : []),
    ...latest,
  ];
  yield {
    type: 'user',
    message: { role: 'user', content: content.length ? content : 'Continue.' },
    parent_tool_use_id: null,
  };
}

function fakeMessage(model: string, text: string, usage: Partial<LlmMessage['usage']>): LlmMessage {
  return {
    id: `cc_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    },
  } as LlmMessage;
}

/**
 * LlmClient for tool-less calls (titles, summaries, memory curator). Chat turns with tools go through
 * agent/sdk-loop instead, because Claude Code runs the tool loop itself.
 */
export function createClaudeCodeClient(rt: ClaudeCodeRuntime): LlmClient {
  return {
    async stream(req, opts) {
      if (req.tools?.length)
        throw new JarvisError(
          'LLM_BAD_REQUEST',
          'tools via subscription client',
          'Computer control needs an Anthropic API key. Switch the connection in Settings → Models & budget.',
        );
      const path = requirePath(rt);
      const query = await rt.query();
      const abortController = new AbortController();
      const onAbort = (): void => abortController.abort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
      let text = '';
      let errorKind: string | undefined;
      try {
        for await (const m of query({
          prompt: promptFor(req.messages),
          options: {
            ...baseOptions(rt, path),
            systemPrompt: systemText(req.system),
            model: req.model,
            maxTurns: 1,
            includePartialMessages: Boolean(opts.onText),
            abortController,
          },
        }) as AsyncIterable<SDKMessage>) {
          if (m.type === 'stream_event') {
            const e = m.event;
            if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
              opts.onText?.(e.delta.text);
            }
          } else if (m.type === 'assistant') {
            errorKind ??= m.error;
            for (const b of m.message.content) if (b.type === 'text') text += b.text;
          } else if (m.type === 'result') {
            if (m.is_error || errorKind) {
              const detail = m.subtype === 'success' ? m.result : m.errors.join('; ');
              throw claudeCodeError(errorKind, detail || m.subtype, req.model);
            }
            return fakeMessage(req.model, text, m.usage);
          }
        }
      } finally {
        opts.signal.removeEventListener('abort', onAbort);
      }
      throw new JarvisError('LLM_NETWORK', 'no result', 'Claude Code stopped without answering.');
    },
    async ping() {
      const status = await claudeCodeStatus(requirePath(rt));
      if (!status.loggedIn) throw new JarvisError('LLM_AUTH', 'not signed in', SIGN_IN);
    },
  };
}
