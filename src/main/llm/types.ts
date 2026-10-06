import type Anthropic from '@anthropic-ai/sdk';

export type LlmRequest = Omit<Anthropic.MessageCreateParamsNonStreaming, 'stream'>;
export type LlmMessage = Anthropic.Message;
export type MessageParam = Anthropic.MessageParam;
export type ContentBlock = Anthropic.ContentBlock;
export type ToolUseBlock = Anthropic.ToolUseBlock;
export type ToolResultBlockParam = Anthropic.ToolResultBlockParam;

export interface StreamOptions {
  signal: AbortSignal;
  onText?: (delta: string) => void;
}

/** The single seam between the app and Claude. Real client and FakeClaude both implement it. */
export interface LlmClient {
  stream(req: LlmRequest, opts: StreamOptions): Promise<LlmMessage>;
  /** Tests an API key with a tiny Haiku call ("Reply OK"). */
  ping(model: string, signal: AbortSignal): Promise<void>;
}
