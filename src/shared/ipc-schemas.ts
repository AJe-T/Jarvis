import { z } from 'zod';
import { LOCAL_MODEL_IDS } from './speech-engines';
import { ScheduleSchema } from './schedule';
import { SecretNameSchema, TIERS } from './types';
import { CLOUD_PROVIDER_IDS, CONNECTION_ID_RE } from './llm-providers';

/** 'office', 'dm:<npc id>' or 'meeting:<meeting id>'. */
export const NpcChannel = z.string().regex(/^(office|dm:npc_[\w-]{1,40}|meeting:mtg_[\w-]{1,40})$/);
export const NpcId = z.string().regex(/^npc_[\w-]{1,40}$/);
export const ConnId = z.string().regex(CONNECTION_ID_RE);
export const RunId = z.string().regex(/^run_[\w-]{1,40}$/);
export const Label = z.string().max(60);
export const AiConnectionSchema = z.object({
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

export const Ok = z.object({ ok: z.literal(true) });

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
export const Empty = z.object({}).strict();
export const OfflineProblemSchema = z.object({ part: z.string(), fix: z.string() });
/** AI Router: a custom provider as Sir types it (main checks it again before use). */
export const CustomProviderInput = z.object({
  name: z.string().min(1).max(40),
  baseUrl: z.string().min(9).max(200),
  model: z.string().min(1).max(120),
  apiKey: z.string().max(500).optional(),
});
export const Id = z.string().min(1).max(64);
export const VaultPath = z.string().min(1).max(400);

export const AttachmentSchema = z.object({
  name: z.string().max(200),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']),
  dataBase64: z.string().max(14_000_000),
});

export const McpServerInput = z.object({
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

export const McpServerView = McpServerInput.extend({
  id: z.string(),
  status: z.enum(['disabled', 'connecting', 'ready', 'error']),
  error: z.string().optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), tier: z.enum(TIERS) })),
});
export type McpServerView = z.infer<typeof McpServerView>;

/** An MCP Registry server Jarvis can install as-is (main/mcp/registry.ts). */
export const RegistryEntry = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  repository: z.string().optional(),
  kind: z.enum(['npm', 'remote']),
  secrets: z.array(z.object({ name: SecretNameSchema, label: z.string(), help: z.string() })),
  server: McpServerInput,
});

export const MemoryEntry = z.object({
  path: z.string(),
  name: z.string(),
  isDir: z.boolean(),
  size: z.number(),
});
export const MemoryHit = z.object({
  vaultPath: z.string(),
  title: z.string(),
  snippet: z.string(),
});
export const ReviewItem = z.object({
  id: z.string(),
  op: z.enum(['ADD', 'UPDATE', 'DELETE']),
  targetPath: z.string().nullable(),
  proposedMarkdown: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string(),
});
export const AuditItem = z.object({
  seq: z.number(),
  ts: z.string(),
  actor: z.string(),
  event: z.string(),
  details: z.string(),
});
/** ADR-011 local voice models (ids from src/main/voice/local/models.json). */
export const LocalModelId = z.enum(LOCAL_MODEL_IDS);
export const CopilotId = z.string().regex(/^cp_[\w-]+$/);
export const CopilotScene = z.enum(['work', 'romance', 'friends', 'family', 'general']);
export const CopilotCapture = z.object({
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
export const CopilotAnalysis = z.object({
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
export const TelegramStatus = z.object({
  running: z.boolean(),
  paired: z.boolean(),
  botName: z.string().nullable(),
  pairingCode: z.string().nullable(),
  error: z.string().nullable(),
});
export const TaskId = z.string().regex(/^task_[\w-]+$/);
export const TaskSchedule = ScheduleSchema;
export const TaskInput = z.object({
  id: TaskId.optional(),
  name: z.string().min(2).max(60),
  kind: z.enum(['briefing', 'task', 'checkin']),
  prompt: z.string().min(5).max(2000),
  schedule: TaskSchedule,
  enabled: z.boolean(),
  speak: z.boolean(),
  saveToVault: z.boolean(),
});
export const TaskView = TaskInput.extend({
  id: TaskId,
  scheduleText: z.string(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastConversationId: z.string().nullable(),
});
export const SkillName = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
export const ForgeRunViewSchema = z.object({
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
/** F9: one message of the Forge chat (stored in <vault>/Forge/Chats). */
export const ForgeMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['sir', 'forge', 'event']),
  text: z.string(),
  at: z.string(),
  tainted: z.boolean(),
  runId: z.string().optional(),
});
/** F10: a path inside Forge's own vault folder (main refuses anything outside Forge/). */
export const ForgePath = z
  .string()
  .max(300)
  .regex(/^Forge(?:\/[^\\:*?"<>|]+)*$/i);

export const SkillView = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string().nullable(),
  enabled: z.boolean(),
  forge: z.boolean(),
  files: z.array(z.string()),
});
/** One link or folder may hold a whole skills library: all installed, plus notes for Sir. */
export const SkillInstallResult = z.object({
  installed: z.array(SkillView),
  warnings: z.array(z.string()),
});
export const PlanWindow = z.object({ usedPercent: z.number(), resetsAt: z.number().nullable() });
export const UsageSummary = z.object({
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
export const BreakdownRow = z.object({
  key: z.string(),
  /** Display name (connections and billing kinds); the key otherwise. */
  label: z.string(),
  costUsd: z.number(),
  tokens: z.number(),
  calls: z.number(),
  /** Calls whose real price is unknown (priced like the dearest model). */
  estimated: z.number(),
});

export const SpaceNameInput = z.string().trim().min(1).max(80);
export const SpaceIcon = z.string().min(1).max(16);
export const RemoteStatus = z.object({
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
export const WhatsAppStatus = z.object({
  state: z.enum(['off', 'connecting', 'qr', 'open', 'error']),
  /** QR code (PNG data URL) to scan in WhatsApp → Linked devices. */
  qr: z.string().nullable(),
  me: z.string().nullable(),
  error: z.string().nullable(),
});
export const PasswordId = z.string().regex(/^pw_[\w-]{4,40}$/);
export const MasterPassword = z.string().min(1).max(200);
export const PasswordSummary = z.object({
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
export const PasswordEntry = z.object({
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

export function contract<Req extends z.ZodType, Res extends z.ZodType>(
  request: Req,
  response: Res,
) {
  return { request, response };
}
