import { z } from 'zod';

export const ASSISTANT_STATES = [
  'IDLE',
  'LISTENING',
  'THINKING',
  'ACTING',
  'AWAITING_CONFIRMATION',
  'SPEAKING',
  'ERROR',
  'SLEEP',
] as const;
export type AssistantState = (typeof ASSISTANT_STATES)[number];

export const TIERS = ['SAFE', 'CONFIRM', 'BLOCKED'] as const;
export type Tier = (typeof TIERS)[number];

export const TOOL_SOURCES = ['native', 'mcp', 'anthropic'] as const;
export type ToolSource = (typeof TOOL_SOURCES)[number];

export const TOOL_DECISIONS = [
  'auto',
  'approved',
  'denied',
  'blocked',
  'cancelled',
  'skipped',
] as const;
export type ToolDecision = (typeof TOOL_DECISIONS)[number];

export const TOOL_STATUSES = [
  'pending',
  'awaiting',
  'running',
  'success',
  'error',
  'not_run',
] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

/** ADR-012 'ambient': always listening on-device; say "Jarvis" anywhere in a sentence. */
export const VOICE_MODES = ['off', 'ptt', 'wake', 'ambient'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const MESSAGE_SOURCES = ['text', 'voice', 'system'] as const;

/** Well-known secret names. MCP servers may use additional names matching SECRET_NAME_RE. */
export const KNOWN_SECRETS = [
  'anthropic',
  'deepgram',
  'openai',
  'picovoice',
  'elevenlabs',
  'github_pat',
  'notion_token',
] as const;
export const SECRET_NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const SecretNameSchema = z.string().regex(SECRET_NAME_RE);

export const UiToolCallSchema = z.object({
  id: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  humanSummary: z.string(),
  tier: z.enum(TIERS),
  status: z.enum(TOOL_STATUSES),
  decision: z.enum(TOOL_DECISIONS).optional(),
  inputPreview: z.string(),
  outputPreview: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
  createdAt: z.string(),
});
export type UiToolCall = z.infer<typeof UiToolCallSchema>;

export const CitationSchema = z.object({ url: z.string(), title: z.string() });
export type Citation = z.infer<typeof CitationSchema>;

export const UiMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'notice']),
  text: z.string(),
  source: z.enum(MESSAGE_SOURCES).optional(),
  interrupted: z.boolean().optional(),
  citations: z.array(CitationSchema).optional(),
  toolCalls: z.array(UiToolCallSchema).optional(),
  createdAt: z.string(),
});
export type UiMessage = z.infer<typeof UiMessageSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  lastActiveAt: z.string(),
  source: z.enum(['text', 'voice', 'mixed']),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ok = { ok: true } as const;
