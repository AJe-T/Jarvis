import { z } from 'zod';
import type { EventChannel, InvokeChannel, SendChannel } from './ipc-channels';
import { SETTING_KEYS, type SettingKey } from './settings';
import {
  ASSISTANT_STATES,
  ConversationSummarySchema,
  SecretNameSchema,
  TIERS,
  UiMessageSchema,
  UiToolCallSchema,
  VOICE_MODES,
} from './types';

const Ok = z.object({ ok: z.literal(true) });
const Empty = z.object({}).strict();
const Id = z.string().min(1).max(64);
const VaultPath = z.string().min(1).max(400);

const AttachmentSchema = z.object({
  name: z.string().max(200),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']),
  dataBase64: z.string().max(14_000_000),
});

const McpServerInput = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/),
  transport: z.enum(['stdio', 'http']),
  command: z.string().max(200).optional(),
  args: z.array(z.string().max(500)).max(40).default([]),
  url: z.string().url().max(500).optional(),
  envSecrets: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/), SecretNameSchema).default({}),
  /** HTTP servers: secret sent as "Authorization: Bearer <secret>". */
  authSecret: SecretNameSchema.optional(),
  trustLevel: z.enum(['official', 'community', 'experimental']),
  defaultTier: z.enum(TIERS).default('CONFIRM'),
  toolOverrides: z.record(z.string(), z.enum(TIERS)).default({}),
  enabled: z.boolean().default(true),
});
export type McpServerInput = z.infer<typeof McpServerInput>;

const McpServerView = McpServerInput.extend({
  id: z.string(),
  status: z.enum(['disabled', 'connecting', 'ready', 'error']),
  error: z.string().optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), tier: z.enum(TIERS) })),
});
export type McpServerView = z.infer<typeof McpServerView>;

const MemoryEntry = z.object({
  path: z.string(),
  name: z.string(),
  isDir: z.boolean(),
  size: z.number(),
});
const MemoryHit = z.object({ vaultPath: z.string(), title: z.string(), snippet: z.string() });
const ReviewItem = z.object({
  id: z.string(),
  op: z.enum(['ADD', 'UPDATE', 'DELETE']),
  targetPath: z.string().nullable(),
  proposedMarkdown: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string(),
});
const AuditItem = z.object({
  seq: z.number(),
  ts: z.string(),
  actor: z.string(),
  event: z.string(),
  details: z.string(),
});
/** ADR-011 local voice models (ids from src/main/voice/local/models.json). */
const LocalModelId = z.enum([
  'whisper-base.en',
  'whisper-small.en',
  'whisper-small',
  'openwakeword-hey-jarvis',
  'silero-vad',
  'minilm-embed',
]);
const CopilotId = z.string().regex(/^cp_[\w-]+$/);
const CopilotCapture = z.object({
  id: CopilotId,
  windowTitle: z.string(),
  chat: z.object({
    app: z.string(),
    contact: z.string(),
    isGroup: z.boolean(),
    messages: z.array(
      z.object({ from: z.enum(['me', 'them']), text: z.string(), time: z.string().optional() }),
    ),
  }),
});
const CopilotAnalysis = z.object({
  theyWant: z.string(),
  tone: z.string(),
  pressure: z.enum(['low', 'medium', 'high']),
  boundaries: z.array(z.string()),
  friction: z.array(z.string()),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      stance: z.string(),
      mustInclude: z.array(z.string()),
      avoid: z.array(z.string()),
      needsDetail: z.string().nullable(),
    }),
  ),
});
const TelegramStatus = z.object({
  running: z.boolean(),
  paired: z.boolean(),
  botName: z.string().nullable(),
  pairingCode: z.string().nullable(),
  error: z.string().nullable(),
});
const TaskId = z.string().regex(/^task_[\w-]+$/);
const TaskSchedule = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('daily'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    days: z.array(z.number().int().min(1).max(7)).max(7),
  }),
  z.object({ type: z.literal('interval'), minutes: z.number().int().min(15).max(10080) }),
]);
const TaskInput = z.object({
  id: TaskId.optional(),
  name: z.string().min(2).max(60),
  kind: z.enum(['briefing', 'task', 'checkin']),
  prompt: z.string().min(5).max(2000),
  schedule: TaskSchedule,
  enabled: z.boolean(),
  speak: z.boolean(),
  saveToVault: z.boolean(),
});
const TaskView = TaskInput.extend({
  id: TaskId,
  scheduleText: z.string(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastConversationId: z.string().nullable(),
});
const SkillName = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
const SkillView = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string().nullable(),
  enabled: z.boolean(),
  files: z.array(z.string()),
});
const UsageSummary = z.object({
  costUsd: z.number(),
  tokens: z.number(),
  budget: z.number(),
  dayCostUsd: z.number(),
  monthCostUsd: z.number(),
  /** API-equivalent cost of calls made through the Claude subscription (not charged, not budgeted). */
  subscriptionCostUsd: z.number(),
});
const BreakdownRow = z.object({
  key: z.string(),
  costUsd: z.number(),
  tokens: z.number(),
  calls: z.number(),
});

function contract<Req extends z.ZodType, Res extends z.ZodType>(request: Req, response: Res) {
  return { request, response };
}

export const INVOKE = {
  'chat:send': contract(
    z.object({
      conversationId: Id.optional(),
      text: z.string().min(1).max(20_000),
      source: z.enum(['text', 'voice']),
      attachments: z.array(AttachmentSchema).max(5).optional(),
    }),
    z.object({ conversationId: z.string(), turnId: z.string() }),
  ),
  'chat:cancel': contract(z.object({ turnId: Id.optional() }), Ok),
  /** isair/jarvis rewind: drop Sir's Nth message and what followed; resend = regenerate from there. */
  'chat:rewind': contract(
    z.object({
      conversationId: Id,
      userIndex: z.number().int().min(0).max(100_000),
      resend: z.boolean(),
    }),
    z.object({ text: z.string(), turnId: z.string().optional() }),
  ),
  'conversations:list': contract(
    z.object({ limit: z.number().int().min(1).max(200), cursor: z.string().max(64).optional() }),
    z.object({ items: z.array(ConversationSummarySchema), nextCursor: z.string().optional() }),
  ),
  'conversations:get': contract(
    z.object({ id: Id }),
    z.object({ conversation: ConversationSummarySchema, messages: z.array(UiMessageSchema) }),
  ),
  'conversations:delete': contract(z.object({ id: Id, alsoVault: z.boolean() }), Ok),
  'confirm:respond': contract(
    z.object({
      requestId: Id,
      decision: z.enum(['approve', 'deny']),
      via: z.enum(['click', 'keyboard']),
    }),
    Ok,
  ),
  'settings:getAll': contract(Empty, z.record(z.string(), z.unknown())),
  'settings:set': contract(
    z.object({ key: z.enum(SETTING_KEYS as [SettingKey, ...SettingKey[]]), value: z.unknown() }),
    Ok,
  ),
  'secrets:set': contract(
    z.object({ name: SecretNameSchema, value: z.string().min(1).max(4000) }),
    z.object({ ok: z.literal(true), last4: z.string() }),
  ),
  'secrets:delete': contract(z.object({ name: SecretNameSchema }), Ok),
  'secrets:status': contract(
    Empty,
    z.record(z.string(), z.object({ set: z.boolean(), last4: z.string().optional() })),
  ),
  'llm:claudeCodeStatus': contract(
    Empty,
    z.object({
      found: z.boolean(),
      path: z.string().nullable(),
      loggedIn: z.boolean(),
      authMethod: z.string().optional(),
      subscriptionType: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
  'llm:claudeCodeLogin': contract(Empty, Ok),
  'llm:localModels': contract(
    Empty,
    z.object({ models: z.array(z.string()), error: z.string().optional() }),
  ),
  'llm:localTest': contract(Empty, z.object({ ok: z.boolean(), error: z.string().optional() })),
  'location:detect': contract(Empty, z.object({ town: z.string() })),
  'telegram:status': contract(Empty, TelegramStatus),
  'copilot:capture': contract(Empty, CopilotCapture),
  'copilot:analyse': contract(
    z.object({
      id: CopilotId,
      scene: z.enum(['work', 'romance', 'friends', 'family', 'general']),
      relationship: z.string().max(30),
      dispute: z.boolean(),
    }),
    CopilotAnalysis,
  ),
  'copilot:draft': contract(
    z.object({ id: CopilotId, optionId: z.string().max(20), details: z.string().max(500) }),
    z.array(
      z.object({
        text: z.string(),
        state: z.enum(['eligible', 'confirm', 'blocked']),
        score: z.number(),
        topPick: z.boolean(),
        problems: z.array(z.string()),
        note: z.string(),
      }),
    ),
  ),
  'copilot:fill': contract(z.object({ id: CopilotId, text: z.string().min(1).max(4000) }), Ok),
  'telegram:restart': contract(Empty, TelegramStatus),
  'telegram:unpair': contract(Empty, Ok),
  'tasks:list': contract(Empty, z.array(TaskView)),
  'tasks:save': contract(TaskInput, z.object({ task: TaskView })),
  'tasks:delete': contract(z.object({ id: TaskId }), Ok),
  'tasks:runNow': contract(z.object({ id: TaskId }), z.object({ conversationId: z.string() })),
  'skills:list': contract(Empty, z.array(SkillView)),
  'skills:read': contract(z.object({ name: SkillName }), z.object({ markdown: z.string() })),
  'skills:installFolder': contract(Empty, z.object({ skill: SkillView.nullable() })),
  'skills:installGitHub': contract(
    z.object({ url: z.string().url().startsWith('https://github.com/').max(500) }),
    z.object({ skill: SkillView }),
  ),
  'skills:remove': contract(z.object({ name: SkillName }), Ok),
  'skills:setEnabled': contract(z.object({ name: SkillName, enabled: z.boolean() }), Ok),
  'dictation:history': contract(
    Empty,
    z.array(
      z.object({
        id: z.string(),
        ts: z.string(),
        raw_text: z.string(),
        final_text: z.string(),
        target_app: z.string().nullable(),
      }),
    ),
  ),
  'dictation:clear': contract(Empty, Ok),
  'models:status': contract(
    Empty,
    z.record(
      z.string(),
      z.object({ installed: z.boolean(), sizeBytes: z.number(), downloading: z.boolean() }),
    ),
  ),
  'models:download': contract(z.object({ id: LocalModelId }), Ok),
  'models:cancel': contract(z.object({ id: LocalModelId }), Ok),
  'models:delete': contract(z.object({ id: LocalModelId }), Ok),
  'secrets:test': contract(
    z.object({ name: z.enum(['anthropic', 'deepgram', 'picovoice']) }),
    z.object({ ok: z.boolean(), error: z.string().optional() }),
  ),
  'memory:list': contract(z.object({ dir: z.string().max(400).default('') }), z.array(MemoryEntry)),
  'memory:read': contract(z.object({ vaultPath: VaultPath }), z.object({ markdown: z.string() })),
  'memory:search': contract(z.object({ query: z.string().min(1).max(200) }), z.array(MemoryHit)),
  'memory:delete': contract(z.object({ vaultPath: VaultPath }), Ok),
  'memory:openInObsidian': contract(z.object({ vaultPath: VaultPath.optional() }), Ok),
  'memory:reviewList': contract(Empty, z.array(ReviewItem)),
  'memory:reviewResolve': contract(
    z.object({ id: Id, decision: z.enum(['accepted', 'rejected']) }),
    Ok,
  ),
  'memory:rebuildIndex': contract(Empty, z.object({ files: z.number() })),
  'mcp:list': contract(Empty, z.array(McpServerView)),
  'mcp:add': contract(McpServerInput, Ok),
  'mcp:update': contract(z.object({ id: Id, patch: McpServerInput.partial() }), Ok),
  'mcp:remove': contract(z.object({ id: Id }), Ok),
  'mcp:restart': contract(z.object({ id: Id }), Ok),
  'voice:setMode': contract(
    z.object({ mode: z.enum(VOICE_MODES) }),
    z.object({ ok: z.boolean(), error: z.string().optional() }),
  ),
  'voice:mic': contract(z.object({ action: z.enum(['start', 'stop', 'meter']) }), Ok),
  'voice:devices': contract(Empty, z.array(z.object({ index: z.number(), name: z.string() }))),
  'app:killSwitch': contract(Empty, Ok),
  'app:info': contract(
    Empty,
    z.object({
      version: z.string(),
      userData: z.string(),
      vaultPath: z.string(),
      isTest: z.boolean(),
      online: z.boolean(),
      dbHealthy: z.boolean(),
    }),
  ),
  'app:openExternal': contract(z.object({ url: z.string().url().max(2000) }), Ok),
  'app:pickFolder': contract(
    z.object({ title: z.string().max(100) }),
    z.object({ path: z.string().nullable() }),
  ),
  'app:setMiniMode': contract(z.object({ on: z.boolean() }), Ok),
  'usage:summary': contract(z.object({ range: z.enum(['day', 'month']) }), UsageSummary),
  'usage:breakdown': contract(
    z.object({ range: z.enum(['day', 'month']), by: z.enum(['model', 'purpose', 'day']) }),
    z.array(BreakdownRow),
  ),
  'audit:list': contract(
    z.object({ limit: z.number().int().min(1).max(500), beforeSeq: z.number().int().optional() }),
    z.object({ items: z.array(AuditItem) }),
  ),
  'audit:verify': contract(
    Empty,
    z.object({ ok: z.boolean(), checked: z.number(), brokenAt: z.number().optional() }),
  ),
  'audit:export': contract(Empty, z.object({ path: z.string().nullable() })),
  'activity:list': contract(
    z.object({ limit: z.number().int().min(1).max(500), conversationId: Id.optional() }),
    z.array(UiToolCallSchema.extend({ conversationId: z.string() })),
  ),
  'routines:list': contract(
    Empty,
    z.array(
      z.object({
        name: z.string(),
        triggers: z.array(z.string()),
        enabled: z.boolean(),
        error: z.string().optional(),
      }),
    ),
  ),
  'reminders:list': contract(
    Empty,
    z.array(z.object({ id: z.string(), text: z.string(), dueAt: z.string(), status: z.string() })),
  ),
  'db:backups': contract(Empty, z.array(z.object({ file: z.string(), createdAt: z.string() }))),
  'db:backupNow': contract(Empty, Ok),
  'db:restore': contract(z.object({ file: z.string().regex(/^jarvis-\d{8}-\d{4}\.db$/) }), Ok),
  'onboarding:complete': contract(
    z.object({
      vaultPath: z.string().min(3).max(400),
      voiceMode: z.enum(VOICE_MODES),
      facts: z
        .object({
          role: z.string().max(200),
          project: z.string().max(200),
          city: z.string().max(100),
        })
        .partial(),
    }),
    Ok,
  ),
  'computer:calibrate': contract(Empty, z.object({ ok: z.boolean(), maxErrorPx: z.number() })),
  /** isair/jarvis-style Logs view: newest lines of the (already redacted) log. */
  'logs:tail': contract(
    z.object({ lines: z.number().int().min(10).max(1000) }),
    z.array(
      z.object({ time: z.string(), level: z.string(), module: z.string(), text: z.string() }),
    ),
  ),
  'app:openFolder': contract(
    z.object({ which: z.enum(['userData', 'logs', 'vault', 'backups']) }),
    Ok,
  ),
} satisfies Record<InvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const EVENTS = {
  'assistant:state': z.object({ state: z.enum(ASSISTANT_STATES), detail: z.string().optional() }),
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
  'music:level': z.object({ rms: z.number() }),
  'voice:transcript': z.object({ text: z.string(), isFinal: z.boolean() }),
  'tts:audio': z.object({
    utteranceId: z.string(),
    seq: z.number(),
    mime: z.enum(['audio/mpeg', 'audio/wav']),
    data: z.instanceof(Uint8Array),
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
  'nav:open': z.object({
    view: z.enum(['chat', 'memory', 'activity', 'connections', 'settings', 'copilot', 'bible']),
    section: z.string().optional(),
  }),
} satisfies Record<EventChannel, z.ZodType>;

export const SEND = {
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
