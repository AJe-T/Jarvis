import type { z } from 'zod';
import type { Tier, ToolSource } from '@shared/types';
import type { Logger } from '../logging/logger';

export interface ToolContext {
  signal: AbortSignal;
  conversationId: string;
  turnId: string;
  tainted: boolean;
  /** The turn already read Sir's private data (memory, files, screen…): never for the free pool. */
  private?: string | undefined;
  logger: Logger;
}

export type ToolContent =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string };
    };

export interface ToolOutput {
  content: ToolContent[];
  isError?: boolean;
  /** Overrides the tool's untrustedOutput default. */
  untrusted?: boolean;
  /** Where untrusted content came from (shown in taint banners). */
  untrustedSource?: string;
}

/** Inputs the policy engine checks against the global BLOCKED rules (Security.md §5 step 3). */
export interface GuardInputs {
  paths?: string[];
  script?: string;
  urls?: Array<{ url: string; allowPrivate?: boolean }>;
  text?: string[];
}

export interface ConfirmDetails {
  title: string;
  actionLabel: string;
  details: string;
  detailsKind: 'text' | 'code' | 'paths';
  purpose?: string;
}

export interface Tool<I = unknown> {
  name: string;
  /** For Claude: what it does, when to use it, when not to, what it returns (≤ ~80 words). */
  description: string;
  input: z.ZodType<I>;
  /** Overrides the JSON Schema sent to Claude (MCP tools bring their own). */
  jsonSchema?: Record<string, unknown>;
  tier: Tier | ((input: I) => Tier);
  destructive?: boolean | ((input: I) => boolean);
  untrustedOutput?: boolean;
  /** Sends data or acts outside this PC (taint escalates these to CONFIRM); may depend on the input. */
  externalFacing?: boolean | ((input: I) => boolean);
  timeoutMs?: number;
  source?: ToolSource;
  summarize(input: I): string;
  confirm?(input: I): Partial<ConfirmDetails>;
  guards?(input: I): GuardInputs;
  run(input: I, ctx: ToolContext): Promise<ToolOutput>;
}

/** Stores a typed tool in the registry. Sound because the executor always parses input with tool.input first. */
export function defineTool<I>(tool: Tool<I>): Tool<unknown> {
  return tool as unknown as Tool<unknown>;
}

export const ok = (text: string): ToolOutput => ({ content: [{ type: 'text', text }] });
export const fail = (text: string): ToolOutput => ({
  content: [{ type: 'text', text }],
  isError: true,
});
