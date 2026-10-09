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
import { PasswordEntryInput } from './passwords';
import { StagePanelSchema } from './stage';
import {
  CalendarId,
  CalendarSchema,
  EventId,
  EventPatchSchema,
  EventSchema,
  ListId,
  LocalDate,
  TodoId,
  TodoListSchema,
  TodoPatchSchema,
  TodoSchema,
} from './planner';

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

/** An MCP Registry server Jarvis can install as-is (main/mcp/registry.ts). */
const RegistryEntry = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  repository: z.string().optional(),
  kind: z.enum(['npm', 'remote']),
  secrets: z.array(z.object({ name: SecretNameSchema, label: z.string(), help: z.string() })),
  server: McpServerInput,
});

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

const SpaceNameInput = z.string().trim().min(1).max(80);
const SpaceIcon = z.string().min(1).max(16);
const RemoteStatus = z.object({
  running: z.boolean(),
  urls: z.array(z.string()),
  port: z.number(),
  pairingCode: z.string().nullable(),
  pairingUrl: z.string().nullable(),
  /** QR code (PNG data URL) of pairingUrl, made in main. */
  pairingQr: z.string().nullable().optional(),
  devices: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      lastSeen: z.string().nullable(),
    }),
  ),
  error: z.string().nullable(),
});
const WhatsAppStatus = z.object({
  state: z.enum(['off', 'connecting', 'qr', 'open', 'error']),
  /** QR code (PNG data URL) to scan in WhatsApp → Linked devices. */
  qr: z.string().nullable(),
  me: z.string().nullable(),
  error: z.string().nullable(),
});
const PasswordId = z.string().regex(/^pw_[\w-]{4,40}$/);
const MasterPassword = z.string().min(1).max(200);
const PasswordSummary = z.object({
  id: z.string(),
  title: z.string(),
  username: z.string(),
  url: z.string(),
  category: z.string(),
  favorite: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  hasPassword: z.boolean(),
  hasTotp: z.boolean(),
  hasNotes: z.boolean(),
});
const PasswordEntry = z.object({
  id: z.string(),
  title: z.string(),
  username: z.string(),
  password: z.string(),
  url: z.string(),
  notes: z.string(),
  category: z.string(),
  totpSecret: z.string(),
  favorite: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
  'mcp:registrySearch': contract(
    z.object({ query: z.string().trim().max(80), cursor: z.string().max(300).optional() }),
    z.object({
      entries: z.array(RegistryEntry),
      /** Servers on this page Jarvis can't run as-is (Python, Docker, custom headers…). */
      skipped: z.number(),
      nextCursor: z.string().optional(),
    }),
  ),
  'voice:setMode': contract(
    z.object({ mode: z.enum(VOICE_MODES) }),
    z.object({ ok: z.boolean(), error: z.string().optional() }),
  ),
  'voice:mic': contract(z.object({ action: z.enum(['start', 'stop', 'meter']) }), Ok),
  /** Phone-keyboard dictation into the message box: words stream in as voice:compose events. */
  'voice:compose': contract(z.object({ action: z.enum(['start', 'stop']) }), Ok),
  /** One click: download Whisper base.en + the voice detector and switch speech to on-device. */
  'voice:setupLocal': contract(Empty, Ok),
  'voice:devices': contract(Empty, z.array(z.object({ index: z.number(), name: z.string() }))),
  'app:killSwitch': contract(Empty, Ok),
  /** Settings Save bar: restart to apply big changes cleanly (audited). */
  'app:relaunch': contract(Empty, Ok),
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
  // Spaces (Notion-style notebooks in the vault).
  'spaces:list': contract(
    Empty,
    z.array(
      z.object({
        name: z.string(),
        icon: z.string(),
        pageCount: z.number(),
        updatedAt: z.string().nullable(),
      }),
    ),
  ),
  'spaces:create': contract(z.object({ name: SpaceNameInput, icon: SpaceIcon }), Ok),
  'spaces:update': contract(
    z.object({
      name: SpaceNameInput,
      next: z.object({ name: SpaceNameInput.optional(), icon: SpaceIcon.optional() }),
    }),
    Ok,
  ),
  'spaces:delete': contract(z.object({ name: SpaceNameInput }), Ok),
  'spaces:pages': contract(
    z.object({ space: SpaceNameInput }),
    z.array(
      z.object({
        name: z.string(),
        updatedAt: z.string(),
        size: z.number(),
        excerpt: z.string(),
        icon: z.string().optional(),
        cover: z.string().optional(),
      }),
    ),
  ),
  'spaces:read': contract(
    z.object({ space: SpaceNameInput, page: SpaceNameInput }),
    z.object({ markdown: z.string(), hash: z.string() }),
  ),
  'spaces:write': contract(
    z.object({
      space: SpaceNameInput,
      page: SpaceNameInput,
      markdown: z.string().max(1_000_000),
      expectedHash: z.string().max(100).optional(),
    }),
    z.object({ markdown: z.string(), hash: z.string() }),
  ),
  'spaces:createPage': contract(
    z.object({
      space: SpaceNameInput,
      title: SpaceNameInput,
      template: z.enum(['blank', 'journal', 'learning', 'meeting', 'finance', 'project']),
    }),
    z.object({ name: z.string() }),
  ),
  'spaces:renamePage': contract(
    z.object({ space: SpaceNameInput, page: SpaceNameInput, next: SpaceNameInput }),
    Ok,
  ),
  'spaces:deletePage': contract(z.object({ space: SpaceNameInput, page: SpaceNameInput }), Ok),
  'spaces:open': contract(z.object({ space: SpaceNameInput, page: SpaceNameInput.optional() }), Ok),
  /** Brain view: every note as a dot, [[links]] and folders as connections. */
  'memory:graph': contract(
    Empty,
    z.object({
      nodes: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          group: z.string(),
          size: z.number(),
          updatedAt: z.string(),
        }),
      ),
      links: z.array(
        z.object({ source: z.string(), target: z.string(), kind: z.enum(['link', 'folder']) }),
      ),
    }),
  ),
  'remote:status': contract(Empty, RemoteStatus),
  'remote:pair': contract(Empty, RemoteStatus),
  'remote:revoke': contract(z.object({ id: z.string().regex(/^[0-9a-f]{12}$/) }), Ok),
  'remote:restart': contract(Empty, RemoteStatus),
  'whatsapp:status': contract(Empty, WhatsAppStatus),
  'whatsapp:restart': contract(Empty, WhatsAppStatus),
  'whatsapp:logout': contract(Empty, Ok),
  // Tasks and Calendar (PRD F25/F26): the views load everything at once and refresh on planner:changed.
  'planner:state': contract(
    Empty,
    z.object({
      lists: z.array(TodoListSchema),
      todos: z.array(TodoSchema),
      calendars: z.array(CalendarSchema),
      events: z.array(EventSchema),
    }),
  ),
  'todos:save': contract(TodoPatchSchema, TodoSchema),
  'todos:delete': contract(z.object({ id: TodoId }), Ok),
  'todos:clearCompleted': contract(Empty, z.object({ count: z.number() })),
  'todos:saveList': contract(
    z.object({
      id: ListId.optional(),
      name: z.string().trim().min(1).max(60),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      icon: z.string().max(16).optional(),
    }),
    TodoListSchema,
  ),
  'todos:deleteList': contract(z.object({ id: ListId }), Ok),
  'calendar:save': contract(EventPatchSchema, EventSchema),
  'calendar:delete': contract(
    z.object({
      id: EventId,
      date: LocalDate.optional(),
      scope: z.enum(['one', 'following', 'all']).optional(),
    }),
    Ok,
  ),
  'calendar:saveCalendar': contract(
    z.object({
      id: CalendarId.optional(),
      name: z.string().trim().min(1).max(60).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      visible: z.boolean().optional(),
    }),
    CalendarSchema,
  ),
  'calendar:deleteCalendar': contract(z.object({ id: CalendarId }), Ok),
  /** Opens a file picker in main; null when Sir cancels. */
  'calendar:importIcs': contract(
    Empty,
    z.object({ name: z.string(), count: z.number(), skipped: z.number() }).nullable(),
  ),
  'calendar:exportIcs': contract(
    z.object({ calendarId: CalendarId.optional() }),
    z.object({ path: z.string().nullable() }),
  ),
  // Mini orb (Design-system.md §4.3): drag, snap to a screen edge, tuck away, caption bubble.
  'mini:dragStart': contract(Empty, Ok),
  'mini:dragEnd': contract(Empty, z.object({ moved: z.boolean() })),
  'mini:tuck': contract(z.object({ tucked: z.boolean() }), Ok),
  'mini:menu': contract(Empty, Ok),
  'mini:caption': contract(z.object({ open: z.boolean() }), Ok),
  // Password manager (Security.md §16.6): only the Passwords view uses these; no tool can.
  'passwords:status': contract(
    Empty,
    z.object({ exists: z.boolean(), unlocked: z.boolean(), count: z.number() }),
  ),
  'passwords:setup': contract(z.object({ master: MasterPassword }), Ok),
  'passwords:unlock': contract(z.object({ master: MasterPassword }), Ok),
  'passwords:lock': contract(Empty, Ok),
  'passwords:list': contract(Empty, z.array(PasswordSummary)),
  'passwords:get': contract(z.object({ id: PasswordId }), PasswordEntry),
  'passwords:save': contract(PasswordEntryInput, PasswordSummary),
  'passwords:delete': contract(z.object({ id: PasswordId }), Ok),
  'passwords:copy': contract(
    z.object({ id: PasswordId, field: z.enum(['username', 'password', 'totp']) }),
    z.object({ clearsInSeconds: z.number() }),
  ),
  'passwords:totp': contract(
    z.object({ id: PasswordId }),
    z.object({ code: z.string(), secondsLeft: z.number() }),
  ),
  'passwords:changeMaster': contract(
    z.object({ current: MasterPassword, next: MasterPassword }),
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
  'voice:compose': z.object({ text: z.string(), final: z.boolean() }),
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
  'passwords:locked': z.object({}),
  'remote:status': RemoteStatus,
  'whatsapp:status': WhatsAppStatus,
  'audio:decode': z.object({ id: z.string(), mime: z.string(), data: z.instanceof(Uint8Array) }),
  /** Core stage: Jarvis shows a panel beside the orb (null = close it). */
  'stage:panel': z.object({ panel: StagePanelSchema.nullable() }),
  'planner:changed': z.object({}),
  'mini:layout': z.object({ side: z.enum(['left', 'right']), tucked: z.boolean() }),
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
