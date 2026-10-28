import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { QueryFn } from '@main/llm/claude-code';

/** What a scripted fake "Claude Code" can do: see the options, and call Jarvis's MCP tools for real. */
export interface FakeIo {
  options: Options;
  prompt: unknown;
  listTools(): Promise<string[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    toolUseId: string,
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
}

export type FakeScript = (io: FakeIo) => AsyncGenerator<unknown>;

/** Stand-in for the Agent SDK's query(): runs `script` and connects to the in-process server over MCP. */
export function fakeClaudeCode(...scripts: FakeScript[]): QueryFn & { calls: Options[] } {
  const calls: Options[] = [];
  const fn = (params: { prompt: unknown; options?: Options }) => {
    const options = params.options ?? {};
    const script = scripts[Math.min(calls.length, scripts.length - 1)];
    calls.push(options);
    let client: Client | null = null;
    async function connect(): Promise<Client> {
      if (client) return client;
      // Jarvis's server, or the only one given (Forge's "forge" server).
      const config = options.mcpServers?.['jarvis'] ?? Object.values(options.mcpServers ?? {})[0];
      const server = (config as unknown as { instance: McpServer }).instance;
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.connect(a);
      client = new Client({ name: 'fake-claude-code', version: '1.0.0' });
      await client.connect(b);
      return client;
    }
    const io: FakeIo = {
      options,
      prompt: params.prompt,
      async listTools() {
        return (await (await connect()).listTools()).tools.map((t) => t.name);
      },
      async callTool(name, args, toolUseId) {
        const r = await (
          await connect()
        ).callTool({
          name,
          arguments: args,
          _meta: { 'claudecode/toolUseId': toolUseId },
        });
        return r as Awaited<ReturnType<FakeIo['callTool']>>;
      },
    };
    return (async function* () {
      try {
        if (!script) throw new Error('fakeClaudeCode: no script');
        yield* script(io) as AsyncGenerator<SDKMessage>;
      } finally {
        await (client as Client | null)?.close();
      }
    })();
  };
  return Object.assign(fn as unknown as QueryFn, { calls });
}

// ── message builders (only the fields Jarvis reads) ───────────────────────────────────────────
const MODEL = 'claude-sonnet-5-5';

export const delta = (text: string) => ({
  type: 'stream_event',
  parent_tool_use_id: null,
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});

export const assistant = (msgId: string, block: Record<string, unknown>, error?: string) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  ...(error ? { error } : {}),
  message: { id: msgId, model: MODEL, content: [block] },
});

export const text = (msgId: string, t: string) => assistant(msgId, { type: 'text', text: t });

export const toolUse = (
  msgId: string,
  id: string,
  name: string,
  input: Record<string, unknown> = {},
) => assistant(msgId, { type: 'tool_use', id, name, input, caller: { type: 'direct' } });

export const toolResults = (
  ...results: Array<{ id: string; content: unknown; isError?: boolean }>
) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: {
    role: 'user',
    content: results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.id,
      content: r.content,
      ...(r.isError ? { is_error: true } : {}),
    })),
  },
});

export const result = (
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' = 'success',
  extra: Record<string, unknown> = {},
) => ({
  type: 'result',
  subtype,
  is_error: subtype !== 'success',
  result: '',
  errors: [],
  usage: {
    input_tokens: 1200,
    output_tokens: 80,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
  ...extra,
});
