import { z } from 'zod';
import { type EventChannel, type InvokeChannel, type SendChannel } from './ipc-channels';
import { SettingKeySchema } from './settings';
import {
  ASSISTANT_STATES,
  ConversationSummarySchema,
  MOODS,
  UiMessageSchema,
  UiToolCallSchema,
} from './types';
import { StagePanelSchema } from './stage';
import { RunViewSchema } from './ai-runs';
import { INVOKE_AI } from './ipc-invoke-ai';
import { INVOKE_APPS } from './ipc-invoke-apps';
import { INVOKE_SYSTEM } from './ipc-invoke-system';
import { NPC_STATES, NpcMeetingSchema, NpcMessageSchema } from './npcs';
import {
  CopilotCapture,
  ForgeMessageSchema,
  ForgeRunViewSchema,
  RemoteStatus,
  TelegramStatus,
  VoiceStatus,
  WhatsAppStatus,
} from './ipc-schemas';

// The IPC contract (API-Guide.md §1): every channel with the Zod schema of its request and
// response. The shared schemas live in ipc-schemas.ts and the invoke channels in three files by
// area; this file joins them, so a channel missing from all of them fails the type check below.
export * from './ipc-schemas';

export const INVOKE = {
  ...INVOKE_AI,
  ...INVOKE_SYSTEM,
  ...INVOKE_APPS,
} satisfies Record<InvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const EVENTS = {
  'assistant:state': z.object({ state: z.enum(ASSISTANT_STATES), detail: z.string().optional() }),
  /** The feeling of the reply being given (agent/mood.ts); the orb takes its colour for a while. */
  'assistant:mood': z.object({ mood: z.enum(MOODS) }),
  'chat:delta': z.object({ turnId: z.string(), conversationId: z.string(), textDelta: z.string() }),
  'chat:message': z.object({
    turnId: z.string(),
    conversationId: z.string(),
    message: UiMessageSchema,
  }),
  'tool:update': z.object({
    turnId: z.string(),
    conversationId: z.string(),
    toolCall: UiToolCallSchema,
  }),
  'confirm:request': z.object({
    requestId: z.string(),
    toolName: z.string(),
    title: z.string(),
    humanSummary: z.string(),
    purpose: z.string().optional(),
    details: z.string(),
    detailsKind: z.enum(['text', 'code', 'paths']),
    actionLabel: z.string(),
    destructive: z.boolean(),
    taintedFrom: z.string().optional(),
    expiresAt: z.string(),
    queuePosition: z.number(),
    queueTotal: z.number(),
  }),
  'confirm:resolved': z.object({ requestId: z.string(), decision: z.enum(['approve', 'deny']) }),
  'voice:level': z.object({ rms: z.number() }),
  'voice:status': VoiceStatus,
  'music:level': z.object({ rms: z.number() }),
  'voice:transcript': z.object({ text: z.string(), isFinal: z.boolean() }),
  'voice:compose': z.object({ text: z.string(), final: z.boolean() }),
  /** Listening was cut short (error, time limit, Esc): the words heard so far, for the message box. */
  'voice:draft': z.object({ text: z.string().max(10_000) }),
  'tts:audio': z.object({
    utteranceId: z.string(),
    seq: z.number(),
    mime: z.enum(['audio/mpeg', 'audio/wav', 'audio/pcm']),
    data: z.instanceof(Uint8Array),
    /** audio/pcm only: samples per second of the 16-bit mono data (voice fix 2B). */
    sampleRate: z.number().int().min(8000).max(48_000).optional(),
    /** End-of-utterance marker (empty data): playback is finished once everything before it has played. */
    last: z.boolean().optional(),
  }),
  'tts:stop': z.object({ utteranceId: z.string().optional() }),
  'dictation:done': z.object({ text: z.string(), app: z.string() }),
  'tasks:changed': z.object({}),
  'copilot:captured': CopilotCapture,
  'telegram:status': TelegramStatus,
  'models:progress': z.object({
    id: z.string(),
    receivedBytes: z.number(),
    totalBytes: z.number(),
    done: z.boolean().optional(),
    error: z.string().optional(),
  }),
  'usage:update': z.object({
    dayCostUsd: z.number(),
    monthCostUsd: z.number(),
    dailyBudget: z.number(),
    model: z.string(),
  }),
  'mcp:status': z.object({
    server: z.string(),
    status: z.enum(['disabled', 'connecting', 'ready', 'error']),
    toolCount: z.number().optional(),
    error: z.string().optional(),
  }),
  notify: z.object({
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
    action: z.enum(['settings:brain', 'settings:voice', 'memory', 'connections']).optional(),
  }),
  'conversation:updated': ConversationSummarySchema,
  'memory:changed': z.object({ vaultPaths: z.array(z.string()) }),
  'computer:active': z.object({ active: z.boolean() }),
  'passwords:locked': z.object({}),
  'remote:status': RemoteStatus,
  'whatsapp:status': WhatsAppStatus,
  'audio:decode': z.object({ id: z.string(), mime: z.string(), data: z.instanceof(Uint8Array) }),
  /** Core stage: Jarvis shows a panel beside the orb (null = close it). */
  'stage:panel': z.object({ panel: StagePanelSchema.nullable() }),
  'planner:changed': z.object({}),
  'npc:message': z.object({ message: NpcMessageSchema }),
  'npc:status': z.object({ npcId: z.string(), state: z.enum(NPC_STATES) }),
  /** A multi-AI run changed (a step started, streamed text, finished). */
  'runs:update': z.object({ run: RunViewSchema }),
  /** AI Router: tiers 1 and 2 are out of limits; may a third-party AI answer? (pool:answer). */
  'pool:ask': z.object({
    requestId: z.string(),
    soonestMin: z.number().nullable(),
    /** pool.tier3EveryTime: no "until Jarvis restarts" choice. */
    everyTime: z.boolean(),
  }),
  'npc:meeting': z.object({ meeting: NpcMeetingSchema }),
  /** F9: a Forge chat message was added (Sir's, the desk's, or a run event). */
  'forge:message': z.object({ message: ForgeMessageSchema }),
  /** F9: the current Forge run moved on (a step, a state, the end, shipping). */
  'forge:update': z.object({ run: ForgeRunViewSchema }),
  'mini:layout': z.object({ side: z.enum(['left', 'right']), tucked: z.boolean() }),
  /** A setting changed in main (e.g. Jarvis switched his personality by voice); the UI follows. */
  'settings:changed': z.object({ key: SettingKeySchema, value: z.unknown() }),
  'nav:open': z.object({
    view: z.enum([
      'chat',
      'memory',
      'activity',
      'connections',
      'settings',
      'copilot',
      'bible',
      'spaces',
      'passwords',
      'brain',
      'tasks',
      'calendar',
      'apps',
      'forge',
    ]),
    section: z.string().optional(),
  }),
} satisfies Record<EventChannel, z.ZodType>;

export const SEND = {
  'audio:decoded': z.object({
    id: z.string().max(64),
    samples: z.instanceof(Float32Array).optional(),
    error: z.string().max(300).optional(),
  }),
  'ui:activeConversation': z.object({ conversationId: z.string().max(64).nullable() }),
  'tts:playback': z.object({
    utteranceId: z.string(),
    event: z.enum(['started', 'finished', 'level']),
    level: z.number().optional(),
  }),
} satisfies Record<SendChannel, z.ZodType>;

export type Req<C extends InvokeChannel> = z.input<(typeof INVOKE)[C]['request']>;
export type ParsedReq<C extends InvokeChannel> = z.output<(typeof INVOKE)[C]['request']>;
export type Res<C extends InvokeChannel> = z.output<(typeof INVOKE)[C]['response']>;
export type EventPayload<E extends EventChannel> = z.output<(typeof EVENTS)[E]>;
export type SendPayload<S extends SendChannel> = z.output<(typeof SEND)[S]>;

export interface JarvisApi {
  call: { [C in InvokeChannel]: (req: Req<C>) => Promise<Res<C>> };
  send: { [S in SendChannel]: (payload: SendPayload<S>) => void };
  on<E extends EventChannel>(event: E, handler: (payload: EventPayload<E>) => void): () => void;
}
