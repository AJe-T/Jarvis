import { z } from 'zod';
import { LOCAL_MODEL_IDS } from './speech-engines';
import { ScheduleSchema } from './schedule';
import type { EventChannel, InvokeChannel, SendChannel } from './ipc-channels';
import { SETTING_KEYS, SettingKeySchema, type SettingKey } from './settings';
import {
  ASSISTANT_STATES,
  MOODS,
  ConversationSummarySchema,
  SecretNameSchema,
  TIERS,
  UiMessageSchema,
  UiToolCallSchema,
  VOICE_MODES,
} from './types';
import { PasswordEntryInput } from './passwords';
import { StagePanelSchema } from './stage';
import { BrainRefSchema, CLOUD_PROVIDER_IDS, CONNECTION_ID_RE } from './llm-providers';
import { RunEstimateSchema, RunRequestSchema, RunViewSchema } from './ai-runs';
import {
  CUSTOM_ID_RE,
  LIVE_STRATEGIES,
  PoolAbilitySettingsSchema,
  PoolDelegationSchema,
  ANALYTICS_RANGES,
  MAX_CHAINS,
  PoolAnalyticsSchema,
  PoolChainSchema,
  ScoreWeightsSchema,
  IMAGE_SIZES,
  PoolSnapshotSchema,
} from './free-pool';
import { AGENT_CLI_IDS } from './agent-clis';
import { NPC_STATES, NpcInputSchema, NpcMeetingSchema, NpcMessageSchema, NpcSchema } from './npcs';

/** 'office', 'dm:<npc id>' or 'meeting:<meeting id>'. */
const NpcChannel = z.string().regex(/^(office|dm:npc_[\w-]{1,40}|meeting:mtg_[\w-]{1,40})$/);
const NpcId = z.string().regex(/^npc_[\w-]{1,40}$/);
const ConnId = z.string().regex(CONNECTION_ID_RE);
const RunId = z.string().regex(/^run_[\w-]{1,40}$/);
const Label = z.string().max(60);
const AiConnectionSchema = z.object({
  id: ConnId,
  provider: z.enum(CLOUD_PROVIDER_IDS),
  label: z.string(),
  secret: z.string(),
  primary: z.boolean(),
  model: z.string(),
  keySet: z.boolean(),
  models: z.array(
    z.object({
      model: z.string(),
      source: z.enum(['live', 'manual', 'cached']),
      favourite: z.boolean(),
      enabled: z.boolean(),
      seenAt: z.string().nullable(),
      price: z
        .object({
          inPerMTok: z.number(),
          outPerMTok: z.number(),
          cacheReadPerMTok: z.number(),
          cacheWritePerMTok: z.number(),
        })
        .nullable(),
      context: z.number().nullable(),
    }),
  ),
});
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

/**
 * Voice fix 1A: the microphone in use, shown in Settings → Voice. echo = the echo-cancelled mic in
 * the capture window; native = PvRecorder (no echo cancellation). idle = closed (press to talk).
 */
export const VoiceStatus = z.object({
  mic: z.object({
    source: z.enum(['echo', 'native']),
    state: z.enum(['ok', 'idle', 'retrying', 'failed']),
    /** Why the echo-cancelled mic failed, or '' */
    detail: z.string(),
    /** The device that opened ('' until it has). */
    device: z.string(),
    /** The chosen microphone wasn't found, so the default one opened. */
    deviceMismatch: z.boolean(),
    /** Microphones the echo-cancelled mic can open, to pick one directly. */
    inputs: z.array(z.object({ deviceId: z.string(), label: z.string() })),
    retryInMs: z.number().nullable(),
  }),
  /**
   * Voice fix 2A, from Jarvis's own replies: off = no echo cancellation; unverified = not checked
   * yet (interrupting by voice waits); verified = his voice stays out of the mic; leaks = it doesn't.
   */
  echo: z.enum(['off', 'unverified', 'verified', 'leaks']),
  /** Voice fix 2B: the speech-to-text engine chosen, the one really listening, and why they differ. */
  hearing: z.object({ chosen: z.string(), engine: z.string(), why: z.string() }),
});
export type VoiceStatus = z.infer<typeof VoiceStatus>;
const Empty = z.object({}).strict();
/** AI Router: a custom provider as Sir types it (main checks it again before use). */
const CustomProviderInput = z.object({
  name: z.string().min(1).max(40),
  baseUrl: z.string().min(9).max(200),
  model: z.string().min(1).max(120),
  apiKey: z.string().max(500).optional(),
});
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
const LocalModelId = z.enum(LOCAL_MODEL_IDS);
const CopilotId = z.string().regex(/^cp_[\w-]+$/);
const CopilotScene = z.enum(['work', 'romance', 'friends', 'family', 'general']);
const CopilotCapture = z.object({
  id: CopilotId,
  windowTitle: z.string(),
  chat: z.object({
    app: z.string(),
    contact: z.string(),
    isGroup: z.boolean(),
    messages: z.array(
      z.object({
        from: z.enum(['me', 'them']),
        text: z.string(),
        time: z.string().optional(),
        name: z.string().optional(),
      }),
    ),
  }),
  /** Who this chat was the last time (Settings never shows it; it's kept for the next capture). */
  remembered: z.object({ scene: CopilotScene, relationship: z.string() }).nullable(),
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
const TaskSchedule = ScheduleSchema;
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
const ForgeRunViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['change', 'tool']),
  goal: z.string(),
  state: z.enum([
    'preparing',
    'installing',
    'building',
    'checking',
    'passed',
    'failed',
    'cancelled',
  ]),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  costUsd: z.number(),
  branch: z.string().nullable(),
  tool: z.string().nullable(),
  error: z.string().nullable(),
  freeEdits: z.number(),
  claudeEdits: z.number(),
  checks: z.array(z.object({ id: z.string(), ok: z.boolean() })),
  ship: z
    .object({
      state: z.enum(['running', 'shipped', 'failed', 'cancelled']),
      version: z.string().nullable(),
      done: z.array(z.string()),
      installer: z.string().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  study: z
    .object({
      source: z.string(),
      notes: z.string().nullable(),
      blocks: z.number(),
      warns: z.number(),
      partial: z.boolean(),
    })
    .nullable(),
  summary: z.string(),
  log: z.array(z.string()),
});

const SkillView = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string().nullable(),
  enabled: z.boolean(),
  forge: z.boolean(),
  files: z.array(z.string()),
});
/** One link or folder may hold a whole skills library: all installed, plus notes for Sir. */
const SkillInstallResult = z.object({
  installed: z.array(SkillView),
  warnings: z.array(z.string()),
});
const PlanWindow = z.object({ usedPercent: z.number(), resetsAt: z.number().nullable() });
const UsageSummary = z.object({
  costUsd: z.number(),
  tokens: z.number(),
  budget: z.number(),
  dayCostUsd: z.number(),
  monthCostUsd: z.number(),
  /** API-equivalent cost of calls made through the Claude subscription (not charged, not budgeted). */
  subscriptionCostUsd: z.number(),
  /** Claude plan windows as last reported by Claude Code (subscription only), percent used. */
  plan: z
    .object({
      fiveHour: PlanWindow.nullable(),
      sevenDay: PlanWindow.nullable(),
      updatedAt: z.number(),
    })
    .nullable(),
});
const BreakdownRow = z.object({
  key: z.string(),
  /** Display name (connections and billing kinds); the key otherwise. */
  label: z.string(),
  costUsd: z.number(),
  tokens: z.number(),
  calls: z.number(),
  /** Calls whose real price is unknown (priced like the dearest model). */
  estimated: z.number(),
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
  /** Context meter (idea from LibreChat): how full the next request's context is, and of what. */
  'conversations:context': contract(
    z.object({ id: Id }),
    z.object({
      usedTokens: z.number(),
      windowTokens: z.number(),
      dialogueTokens: z.number(),
      toolTokens: z.number(),
      otherTokens: z.number(),
      estimated: z.boolean(),
      messages: z.number(),
      summarizedMessages: z.number(),
    }),
  ),
  /** Save a chat artifact where Sir picks (a Save dialog); null when he cancels. */
  'artifacts:save': contract(
    z.object({
      title: z.string().min(1).max(80),
      ext: z.enum(['html', 'svg']),
      content: z.string().max(5_000_000),
    }),
    z.object({ path: z.string().nullable() }),
  ),
  /** Search every past chat (idea from LibreChat): best matching messages, one per conversation. */
  'conversations:search': contract(
    z.object({ query: z.string().min(1).max(200) }),
    z.array(
      z.object({
        conversationId: z.string(),
        title: z.string().nullable(),
        snippet: z.string(),
        role: z.string(),
        createdAt: z.string(),
      }),
    ),
  ),
  /** /compact: fold the conversation so far into its running summary. */
  'conversations:compact': contract(
    z.object({ id: Id }),
    z.object({ summarizedMessages: z.number() }),
  ),
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
  /** The cloud provider chosen in Settings → Brain: its model list, and a test call. */
  'llm:cloudModels': contract(
    Empty,
    z.object({ models: z.array(z.string()), error: z.string().optional() }),
  ),
  'llm:cloudTest': contract(Empty, z.object({ ok: z.boolean(), error: z.string().optional() })),
  /** Integrations step 4: one request to several AIs (shared/ai-runs.ts); updates come as runs:update. */
  /** What a run may cost at most, and whether Sir must confirm it (integrations step 5). */
  'runs:estimate': contract(RunRequestSchema, RunEstimateSchema),
  /** `acceptUsd`: the estimate Sir confirmed; needed when the estimate is over his confirm level. */
  'runs:start': contract(
    z.object({ request: RunRequestSchema, acceptUsd: z.number().min(0).max(1000).optional() }),
    RunViewSchema,
  ),
  'runs:cancel': contract(z.object({ id: RunId }), Ok),
  'runs:list': contract(Empty, z.array(RunViewSchema)),
  'runs:remove': contract(z.object({ id: RunId }), Ok),
  'runs:clear': contract(Empty, z.object({ removed: z.number().int() })),
  /** Forge F7: Sidebar → Forge, every saved run (read-only; Forge's own files, checked in main). */
  'forge:runs': contract(Empty, z.array(ForgeRunViewSchema)),
  /** AIs that can take part right now, by name. */
  'runs:brains': contract(Empty, z.array(z.object({ id: BrainRefSchema, label: z.string() }))),
  /** AI Router (2.30): the free pool's live state (no prompts, no answers, no keys). */
  'pool:snapshot': contract(Empty, PoolSnapshotSchema),
  'pool:setProvider': contract(
    z.object({
      // A custom provider (custom_<n>) can only be switched on/off: it stays tier 3.
      id: z.union([z.enum(CLOUD_PROVIDER_IDS), z.string().regex(CUSTOM_ID_RE)]),
      enabled: z.boolean().optional(),
      tier: z.union([z.literal(2), z.literal(3)]).optional(),
      /** Sir's own daily allowance (Usage tab); null clears it back to Jarvis's numbers. */
      tpd: z.number().int().positive().max(1e12).nullable().optional(),
      rpd: z.number().int().positive().max(1e9).nullable().optional(),
    }),
    PoolSnapshotSchema,
  ),
  /** Switch a model on/off, or move it one place in the Priority order. */
  'pool:setModel': contract(
    z.object({
      model: z.string().min(1).max(200),
      enabled: z.boolean().optional(),
      move: z.union([z.literal(-1), z.literal(1)]).optional(),
    }),
    PoolSnapshotSchema,
  ),
  'pool:settings': contract(
    z.object({
      enabled: z.boolean().optional(),
      strategy: z.enum(LIVE_STRATEGIES).optional(),
      tier3: z.enum(['ask', 'never']).optional(),
      tier3EveryTime: z.boolean().optional(),
      keyOrder: z.enum(['roomiest', 'turns']).optional(),
      checkHours: z.number().int().min(0).max(24).optional(),
      retryEmpty: z.boolean().optional(),
      delegation: PoolDelegationSchema.partial().optional(),
      abilities: PoolAbilitySettingsSchema.partial().optional(),
      weights: ScoreWeightsSchema.optional(),
      learn: z.boolean().optional(),
      shrink: z.boolean().optional(),
    }),
    PoolSnapshotSchema,
  ),
  /** Phase 4 named chains: the whole list, replaced at once. */
  'pool:setChains': contract(
    z.object({ chains: z.array(PoolChainSchema).max(MAX_CHAINS) }),
    PoolSnapshotSchema,
  ),
  'pool:analytics': contract(z.object({ range: z.enum(ANALYTICS_RANGES) }), PoolAnalyticsSchema),
  /** One "Reply with OK" to each tier-2 door of a model. */
  'pool:testModel': contract(
    z.object({ model: z.string().min(1).max(200) }),
    z.array(
      z.object({
        provider: z.string(),
        name: z.string(),
        ok: z.boolean(),
        ms: z.number(),
        reason: z.string().optional(),
      }),
    ),
  ),
  /**
   * AI Router → Abilities → Generate (Sir's click). Main checks the prompt for private data, asks
   * before a tier-3 model, and saves the picture to the vault; `by` names who made it.
   */
  'pool:image': contract(
    z.object({ prompt: z.string().trim().min(1).max(1000), size: z.enum(IMAGE_SIZES) }),
    z.object({ path: z.string(), by: z.string(), dataUrl: z.string() }),
  ),
  /** One model-list call per key; clears pauses caused by a key that now works. */
  'pool:checkKeys': contract(Empty, PoolSnapshotSchema),
  /** .env paste: `apply: false` only says what was found (names, never values). */
  'pool:importEnv': contract(
    z.object({ text: z.string().max(50_000), apply: z.boolean() }),
    z.object({
      found: z.array(z.object({ name: z.string(), provider: z.string() })),
      saved: z.array(z.object({ provider: z.string(), connectionId: z.string() })),
      skipped: z.array(z.object({ provider: z.string(), reason: z.string() })),
    }),
  ),
  /**
   * ADR-045: Sir's own OpenAI-compatible provider, always tier 3. Main checks the address (HTTPS,
   * public host, no bare IP, its DNS answer), keeps it fixed, and stores the key in DPAPI.
   */
  'pool:addCustom': contract(CustomProviderInput, PoolSnapshotSchema),
  /** Same checks, then a one-token "Reply OK"; nothing is saved. */
  'pool:testCustom': contract(
    CustomProviderInput,
    z.object({ ok: z.boolean(), error: z.string().optional() }),
  ),
  'pool:removeCustom': contract(
    z.object({ id: z.string().regex(CUSTOM_ID_RE) }),
    PoolSnapshotSchema,
  ),
  /** Sir's answer to "Use third-party AIs?" (pool:ask). */
  'pool:answer': contract(
    z.object({ requestId: z.string().uuid(), answer: z.enum(['once', 'session', 'no']) }),
    Ok,
  ),
  /** Integrations step 3: every connection (key) per provider and its model registry. Keys stay in main. */
  'ai:connections': contract(Empty, z.array(AiConnectionSchema)),
  'ai:connection': contract(
    z.discriminatedUnion('action', [
      z.object({ action: z.literal('add'), provider: z.enum(CLOUD_PROVIDER_IDS), label: Label }),
      z.object({ action: z.literal('rename'), id: ConnId, label: Label }),
      z.object({ action: z.literal('setModel'), id: ConnId, model: z.string().max(120) }),
      z.object({ action: z.literal('remove'), id: ConnId }),
      /** Fetch the provider's model list into the registry. */
      z.object({ action: z.literal('refresh'), id: ConnId }),
      z.object({ action: z.literal('test'), id: ConnId }),
      z.object({ action: z.literal('addModel'), id: ConnId, model: z.string().min(1).max(120) }),
      z.object({ action: z.literal('removeModel'), id: ConnId, model: z.string().max(120) }),
      z.object({
        action: z.literal('flags'),
        id: ConnId,
        model: z.string().max(120),
        favourite: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }),
    ]),
    z.object({ ok: z.boolean(), error: z.string().optional(), id: z.string().optional() }),
  ),
  /** Sir's ChatGPT / Google plans through their official apps (llm/cli-brains.ts). */
  'llm:cliStatus': contract(
    Empty,
    z.array(
      z.object({
        id: z.enum(['chatgpt', 'antigravity']),
        label: z.string(),
        installed: z.boolean(),
        signedIn: z.boolean().nullable(),
        installHint: z.string(),
      }),
    ),
  ),
  /** Coding agents / AI command-line apps found on this PC (llm/agent-clis.ts); files only, nothing run. */
  'llm:agentClis': contract(
    Empty,
    z.array(
      z.object({
        id: z.enum(AGENT_CLI_IDS),
        label: z.string(),
        vendor: z.string(),
        use: z.enum(['main-brain', 'answer-brain', 'detected']),
        installed: z.boolean(),
        path: z.string().nullable(),
        version: z.string().nullable(),
        install: z.string(),
        docsUrl: z.string(),
        note: z.string().nullable(),
      }),
    ),
  ),
  'llm:cliLogin': contract(z.object({ id: z.enum(['chatgpt', 'antigravity']) }), Ok),
  'llm:cliTest': contract(
    z.object({ id: z.enum(['chatgpt', 'antigravity']) }),
    z.object({ ok: z.boolean(), error: z.string().optional() }),
  ),
  'location:detect': contract(Empty, z.object({ town: z.string() })),
  /** Live PC monitor panel: one sample (CPU % since the previous call). */
  'system:stats': contract(
    Empty,
    z.object({
      cpuPercent: z.number(),
      cpuModel: z.string(),
      cores: z.number(),
      memUsedBytes: z.number(),
      memTotalBytes: z.number(),
      diskUsedBytes: z.number().nullable(),
      diskTotalBytes: z.number().nullable(),
      uptimeSec: z.number(),
    }),
  ),
  'telegram:status': contract(Empty, TelegramStatus),
  'copilot:capture': contract(Empty, CopilotCapture),
  'copilot:analyse': contract(
    z.object({
      id: CopilotId,
      scene: CopilotScene,
      relationship: z.string().max(30),
      dispute: z.boolean(),
    }),
    CopilotAnalysis,
  ),
  'copilot:quick': contract(
    z.object({ id: CopilotId, scene: CopilotScene, relationship: z.string().max(30) }),
    z.array(z.string()),
  ),
  'copilot:refine': contract(
    z.object({
      id: CopilotId,
      text: z.string().min(1).max(4000),
      how: z.enum(['shorter', 'warmer', 'firmer', 'formal', 'casual', 'emoji', 'translate']),
      language: z.string().max(40).optional(),
    }),
    z.object({ text: z.string() }),
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
  'skills:installFolder': contract(Empty, SkillInstallResult),
  'skills:installGitHub': contract(
    z.object({ url: z.string().url().startsWith('https://github.com/').max(500) }),
    SkillInstallResult,
  ),
  'skills:remove': contract(z.object({ name: SkillName }), Ok),
  'skills:setEnabled': contract(z.object({ name: SkillName, enabled: z.boolean() }), Ok),
  'skills:setForge': contract(z.object({ name: SkillName, forge: z.boolean() }), Ok),
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
  /** Import a ChatGPT or Claude.ai export (.zip or conversations.json) into Memory/Imports. */
  'memory:importChats': contract(
    Empty,
    z.object({
      cancelled: z.boolean(),
      source: z.enum(['chatgpt', 'claude', 'mixed']).nullable(),
      imported: z.number(),
      skipped: z.number(),
      failed: z.number(),
      total: z.number(),
    }),
  ),
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
  'voice:mic': contract(z.object({ action: z.enum(['start', 'stop', 'meter', 'retry']) }), Ok),
  /** The microphone in use (voice fix 1A); changes arrive as voice:status events. */
  'voice:status': contract(Empty, VoiceStatus),
  /** Open this Chromium microphone for echo cancellation from now on (when the name didn't match). */
  'voice:captureDevice': contract(z.object({ deviceId: z.string().max(300) }), Ok),
  /** Phone-keyboard dictation into the message box: words stream in as voice:compose events. */
  'voice:compose': contract(z.object({ action: z.enum(['start', 'stop']) }), Ok),
  /** One click: download Whisper base.en + the voice detector and switch speech to on-device. */
  'voice:setupLocal': contract(Empty, Ok),
  'voice:devices': contract(Empty, z.array(z.object({ index: z.number(), name: z.string() }))),
  /**
   * ADR-039 Voice Match enrolment: 'sample' records one "Hey <name>" in main (ADR-007) and keeps
   * only its fingerprint; 'finish' saves the profile; 'cancel' drops the phrases; 'delete' forgets it.
   */
  'voice:enrol': contract(
    z.object({ action: z.enum(['sample', 'finish', 'cancel', 'delete']) }),
    z.object({
      ok: z.literal(true),
      count: z.number().int().optional(),
      heard: z.string().optional(),
      threshold: z.number().optional(),
      aliases: z.array(z.string()).optional(),
      scores: z.array(z.number()).optional(),
      /** ADR-043: the phrases also became the personal wake word. */
      wakeWord: z.boolean().optional(),
      /** ADR-044: the keyword-spotter level the phrases pass at (0 = not calibrated). */
      spotterLevel: z.number().optional(),
    }),
  ),
  'voice:profile': contract(
    Empty,
    z.object({
      enrolled: z.boolean(),
      wakeTrained: z.boolean(),
      phrases: z.number().int(),
      needed: z.number().int(),
    }),
  ),
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
  /** The window buttons' colours follow the theme (no Windows title bar, §5.1). */
  'app:titleBar': contract(
    z.object({
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      symbolColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
    Ok,
  ),
  'usage:summary': contract(z.object({ range: z.enum(['day', 'month']) }), UsageSummary),
  'usage:breakdown': contract(
    z.object({
      range: z.enum(['day', 'month']),
      by: z.enum(['model', 'purpose', 'day', 'source', 'billing']),
    }),
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
  /**
   * ADR-040: where Core's panel for a docked app (browser, terminal, camera) is, in CSS px; bounds
   * null = covered by a dialog; open false = the panel closed.
   */
  'apps:dock': contract(
    z.object({
      app: z.enum(['browser', 'terminal', 'camera']),
      open: z.boolean(),
      bounds: z
        .object({
          x: z.number().finite(),
          y: z.number().finite(),
          width: z.number().finite().min(0).max(20_000),
          height: z.number().finite().min(0).max(20_000),
        })
        .nullable(),
    }),
    Ok,
  ),
  'apps:timerAdd': contract(
    z.object({
      seconds: z.number().int().min(1).max(86_400),
      label: z.string().trim().min(1).max(100),
    }),
    Ok,
  ),
  'apps:timerCancel': contract(z.object({ id: z.string().max(80) }), Ok),
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
      /** Required when creating; a patch may leave it out. */
      name: z.string().trim().min(1).max(60).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      icon: z.string().max(16).optional(),
      sortOrder: z.number().finite().optional(),
      description: z.string().max(500).optional(),
      wipLimit: z.number().int().min(1).max(50).nullable().optional(),
      archived: z.boolean().optional(),
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
  /** NPCs (2.21): Sir's team of single-purpose agents, Jarvis at their head. */
  'npcs:list': contract(
    Empty,
    z.object({
      npcs: z.array(NpcSchema),
      states: z.record(z.string(), z.enum(NPC_STATES)),
      /** Brains set up right now (the editor offers only these). */
      brains: z.array(BrainRefSchema),
      /** Names for Sir's extra connections (conn_...), which the brain list doesn't know. */
      brainLabels: z.record(z.string(), z.string()),
      /** Jarvis's tools an NPC may be given (his policy still applies to every call). */
      tools: z.array(z.object({ name: z.string(), description: z.string() })),
    }),
  ),
  'npcs:create': contract(NpcInputSchema, NpcSchema),
  'npcs:update': contract(z.object({ id: NpcId, input: NpcInputSchema }), NpcSchema),
  'npcs:delete': contract(z.object({ id: NpcId }), Ok),
  'npcs:messages': contract(z.object({ channel: NpcChannel }), z.array(NpcMessageSchema)),
  /** Sir writes in a channel; replies arrive as npc:message events. */
  'npcs:send': contract(z.object({ channel: NpcChannel, text: z.string().min(1).max(8000) }), Ok),
  'npcs:clear': contract(z.object({ channel: NpcChannel }), Ok),
  'npcs:memory': contract(
    z.object({ id: NpcId }),
    z.object({ path: z.string(), markdown: z.string() }),
  ),
  'npcs:meetings': contract(Empty, z.array(NpcMeetingSchema)),
  'npcs:startMeeting': contract(
    z.object({
      topic: z.string().min(3).max(300),
      attendees: z.array(NpcId).min(1).max(6),
      rounds: z.number().int().min(1).max(3),
    }),
    NpcMeetingSchema,
  ),
  'npcs:stopMeeting': contract(z.object({ id: z.string().regex(/^mtg_[\w-]{1,40}$/) }), Ok),
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
