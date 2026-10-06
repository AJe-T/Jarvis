import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Tool } from './types';

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20260318',
  name: 'web_search',
  max_uses: 5,
} as const;

/** Tools whose definition is Anthropic-defined (e.g., the memory tool) carry it here. */
export type AnthropicDefinedTool = Tool & { anthropicDefinition: Anthropic.ToolUnion };

function inputSchema(tool: Tool): Anthropic.Tool.InputSchema {
  if (tool.jsonSchema) return { type: 'object', ...tool.jsonSchema };
  const { $schema: _drop, ...schema } = z.toJSONSchema(tool.input, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return schema as Anthropic.Tool.InputSchema;
}

/** API-Guide.md §2.2: one registry for native, MCP and Anthropic-defined tools. */
export function createToolRegistry(opts: { webSearchEnabled(): boolean }) {
  const tools = new Map<string, Tool>();
  const providers: Array<() => Tool[]> = [];

  function all(): Tool[] {
    const dynamic = providers.flatMap((p) => p());
    return [...tools.values(), ...dynamic];
  }

  return {
    register(tool: Tool): void {
      if (tools.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name))
        throw new Error(`Invalid tool name: ${tool.name}`);
      tools.set(tool.name, tool);
    },
    unregister(name: string): void {
      tools.delete(name);
    },
    /** Dynamic sources (MCP servers) whose tool list changes at runtime. */
    addProvider(provider: () => Tool[]): void {
      providers.push(provider);
    },
    get(name: string): Tool | undefined {
      return tools.get(name) ?? providers.flatMap((p) => p()).find((t) => t.name === name);
    },
    all,
    catalog() {
      return all().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: inputSchema(t),
      }));
    },
    definitions(): Anthropic.ToolUnion[] {
      const defs: Anthropic.ToolUnion[] = all().map((t) =>
        'anthropicDefinition' in t
          ? (t as AnthropicDefinedTool).anthropicDefinition
          : { name: t.name, description: t.description, input_schema: inputSchema(t) },
      );
      if (opts.webSearchEnabled()) defs.push({ ...WEB_SEARCH_TOOL });
      // Cache order is tools → system → messages: mark the end of the tool list (API-Guide.md §3.2).
      const last = defs.at(-1);
      if (last) defs[defs.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
      return defs;
    },
  };
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>;
