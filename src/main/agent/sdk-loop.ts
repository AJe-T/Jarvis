import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { isAbortError } from '../errors';
import {
  baseOptions,
  claudeCodeError,
  promptFor,
  requirePath,
  systemText,
  type ClaudeCodeRuntime,
} from '../llm/claude-code';
import type { LlmMessage, ToolResultBlockParam, ToolUseBlock } from '../llm/types';
import { newId } from '../lib/util';
import type {
  LoopDeps,
  LoopHooks,
  LoopRequest,
  LoopResult,
  ToolRuntime,
  TurnContext,
} from './agent-loop';

const SERVER = 'jarvis';
const PREFIX = `mcp__${SERVER}__`;
/** Claude Code's own web search; Security.md §6.3 treats its results as untrusted. */
const WEB_SEARCH = 'WebSearch';
/** Computer control needs the API-only computer-use toolset (ADR-010). */
const API_ONLY_TOOLS = new Set(['delegate_desktop_task']);
/** Longer than a confirmation (120 s) plus the slowest tool timeout. */
const TOOL_CALL_TIMEOUT_MS = 10 * 60_000;

const SUBSCRIPTION_NOTE = `\n\n## Connection\nYou are running through Sir's Claude subscription. Your tools are named with the prefix "${PREFIX}" (for example ${PREFIX}open_app); tool descriptions refer to them without it. Computer control (moving the mouse, typing into apps) is not available in this mode: if Sir asks for it, say it needs an Anthropic API key (Settings → Models & budget).`;

type ResultBlock = { type: string; text?: string; source?: { data?: string; media_type?: string } };

function toMcpResult(r: ToolResultBlockParam): CallToolResult {
  const blocks: ResultBlock[] =
    typeof r.content === 'string'
      ? [{ type: 'text', text: r.content }]
      : ((r.content ?? []) as ResultBlock[]);
  return {
    content: blocks.flatMap((b): CallToolResult['content'] => {
      if (b.type === 'text') return [{ type: 'text', text: b.text ?? '' }];
      if (b.type === 'image' && b.source?.data)
        return [
          { type: 'image', data: b.source.data, mimeType: b.source.media_type ?? 'image/png' },
        ];
      return [];
    }),
    ...(r.is_error ? { isError: true } : {}),
  };
}

/** In-process MCP server whose handlers run the normal Jarvis executor (policy, confirmations, audit). */
export function createJarvisMcpServer(tools: ToolRuntime, ctx: TurnContext): McpServer {
  const catalog = (tools.catalog?.() ?? []).filter((t) => !API_ONLY_TOOLS.has(t.name));
  const mcp = new McpServer({ name: SERVER, version: '1.0.0' }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: catalog.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { ...t.inputSchema, type: 'object' as const },
    })),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (!catalog.some((t) => t.name === name))
      return { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true };
    const meta = req.params._meta as Record<string, unknown> | undefined;
    const id =
      typeof meta?.['claudecode/toolUseId'] === 'string'
        ? meta['claudecode/toolUseId']
        : newId('toolu_');
    const block = { type: 'tool_use', id, name, input: req.params.arguments ?? {} } as ToolUseBlock;
    return toMcpResult(await tools.execute(block, ctx));
  });
  return mcp;
}

type Content = LlmMessage['content'][number];

/** Stored history uses Jarvis's own tool names, so activity, history and the UI stay the same in both modes. */
function stripPrefix(b: Content): Content {
  if (b.type !== 'tool_use') return b;
  const name = b.name.startsWith(PREFIX) ? b.name.slice(PREFIX.length) : b.name;
  // Only the Messages API fields, so the history stays valid if Sir switches back to an API key.
  return { type: 'tool_use', id: b.id, name, input: b.input } as Content;
}

/**
 * Same contract as runAgentLoop, but Claude Code runs the loop and calls Jarvis tools over MCP.
 * Budget limits don't apply: subscription calls are recorded with billing "subscription".
 */
export function createSdkLoop(rt: ClaudeCodeRuntime, opts: { webSearchEnabled(): boolean }) {
  return async function runSdkLoop(
    deps: LoopDeps,
    ctx: TurnContext,
    req: LoopRequest,
    hooks: LoopHooks,
  ): Promise<LoopResult> {
    const path = requirePath(rt);
    const query = await rt.query();
    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort();
    if (ctx.signal.aborted) abortController.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const web = opts.webSearchEnabled();
    const server: McpServerConfig = {
      type: 'sdk',
      name: SERVER,
      instance: createJarvisMcpServer(deps.tools, ctx),
      timeout: TOOL_CALL_TIMEOUT_MS,
    };
    const toolNames = new Map<string, string>();
    let fullText = '';
    let stepText = '';
    let step: { id: string; content: Content[]; model: string } | null = null;
    let errorKind: string | undefined;
    let iterations = 0;

    const flush = (): void => {
      if (!step) return;
      const content = step.content.map(stripPrefix);
      const plain = content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      fullText += plain;
      hooks.onStep?.({ content, model: step.model } as LlmMessage);
      hooks.persist([
        {
          role: 'assistant',
          content,
          textPlain: plain,
          source: 'text',
          model: step.model,
          stopReason: null,
        },
      ]);
      step = null;
      stepText = '';
    };

    try {
      for await (const m of query({
        prompt: promptFor(req.messages),
        options: {
          ...baseOptions(rt, path),
          tools: web ? [WEB_SEARCH] : [],
          // The only gate: Jarvis tools (which then pass Jarvis's own policy) and WebSearch; nothing else.
          canUseTool: async (name, input) =>
            name.startsWith(PREFIX) || (web && name === WEB_SEARCH)
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: `${name} is not available to Jarvis.` },
          mcpServers: { [SERVER]: server },
          systemPrompt: systemText(req.system) + SUBSCRIPTION_NOTE,
          model: req.model,
          maxTurns: deps.maxIterations,
          includePartialMessages: true,
          abortController,
        },
      }) as AsyncIterable<SDKMessage>) {
        if (m.type === 'stream_event') {
          const e = m.event;
          if (
            m.parent_tool_use_id === null &&
            e.type === 'content_block_delta' &&
            e.delta.type === 'text_delta'
          ) {
            stepText += e.delta.text;
            hooks.onText(e.delta.text);
          }
        } else if (m.type === 'assistant' && m.parent_tool_use_id === null) {
          errorKind ??= m.error;
          if (step && step.id !== m.message.id) flush();
          if (!step) {
            iterations++;
            step = { id: m.message.id, content: [], model: m.message.model };
          }
          for (const b of m.message.content as Content[]) {
            if (b.type === 'thinking' || b.type === 'redacted_thinking') continue;
            if (b.type === 'tool_use') toolNames.set(b.id, b.name);
            step.content.push(b);
          }
        } else if (m.type === 'user' && m.parent_tool_use_id === null) {
          flush();
          const content = m.message.content;
          if (!Array.isArray(content)) continue;
          const results = content.filter((b) => b.type === 'tool_result');
          if (!results.length) continue;
          if (results.some((r) => toolNames.get(r.tool_use_id) === WEB_SEARCH)) {
            ctx.taint.tainted = true;
            ctx.taint.source ??= 'web search results';
          }
          hooks.persist([{ role: 'user', content: results, textPlain: '', source: 'system' }]);
        } else if (m.type === 'result') {
          flush();
          deps.ledger.record({ model: req.model, usage: m.usage }, ctx.purpose, ctx.conversationId);
          if (m.subtype === 'error_max_turns') {
            const limitText = `\n\nI've stopped after ${deps.maxIterations} steps, sir, to avoid running away with this. Tell me if you'd like me to continue.`;
            hooks.onText(limitText);
            hooks.persist([
              {
                role: 'assistant',
                content: [{ type: 'text', text: limitText.trim() }],
                textPlain: limitText.trim(),
                source: 'text',
                model: req.model,
                stopReason: 'max_iterations',
              },
            ]);
            return {
              outcome: 'max_iterations',
              text: fullText + limitText,
              citations: [],
              iterations,
            };
          }
          if (ctx.signal.aborted)
            return { outcome: 'aborted', text: fullText, citations: [], iterations };
          if (m.is_error || errorKind) {
            const detail = m.subtype === 'success' ? m.result : m.errors.join('; ');
            throw claudeCodeError(errorKind, detail || m.subtype, req.model);
          }
          return { outcome: 'end_turn', text: fullText, citations: [], iterations };
        }
      }
    } catch (err) {
      if (!isAbortError(err) && !ctx.signal.aborted) throw err;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
    // Aborted (kill switch, barge-in, Stop): keep what was already said, like the API loop.
    const partial = stepText;
    step = null;
    if (partial)
      hooks.persist([
        {
          role: 'assistant',
          content: [{ type: 'text', text: partial }],
          textPlain: partial,
          source: 'text',
          model: req.model,
          stopReason: 'interrupted',
        },
      ]);
    return { outcome: 'aborted', text: fullText + partial, citations: [], iterations };
  };
}

export type SdkLoop = ReturnType<typeof createSdkLoop>;
