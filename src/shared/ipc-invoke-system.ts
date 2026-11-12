import { z } from 'zod';
import { UiToolCallSchema, VOICE_MODES } from './types';
import {
  AuditItem,
  BreakdownRow,
  CopilotAnalysis,
  CopilotCapture,
  CopilotId,
  CopilotScene,
  Empty,
  Id,
  LocalModelId,
  McpServerInput,
  McpServerView,
  MemoryEntry,
  MemoryHit,
  Ok,
  RegistryEntry,
  ReviewItem,
  SkillInstallResult,
  SkillName,
  SkillView,
  TaskId,
  TaskInput,
  TaskView,
  TelegramStatus,
  UsageSummary,
  VaultPath,
  VoiceStatus,
  contract,
} from './ipc-schemas';

/** This PC, memory, voice, settings, the window and the smaller features. Part of INVOKE (ipc-contract.ts puts the parts together and checks none is missing). */
export const INVOKE_SYSTEM = {
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
  /** Voice v2: record one phrase and report what was heard, the wake word, the level and the time. */
  'voice:check': contract(
    Empty,
    z.object({
      recorded: z.boolean(),
      heard: z.string(),
      engine: z.string(),
      wake: z.boolean().nullable(),
      levelDb: z.number(),
      ms: z.number(),
      advice: z.string(),
    }),
  ),
  /** Open this Chromium microphone for echo cancellation from now on (when the name didn't match). */
  'voice:captureDevice': contract(z.object({ deviceId: z.string().max(300) }), Ok),
  /** Phone-keyboard dictation into the message box: words stream in as voice:compose events. */
  'voice:compose': contract(z.object({ action: z.enum(['start', 'stop']) }), Ok),
  /** 4.4 "Read aloud" on a reply: speak this text now, or stop. */
  'voice:speak': contract(
    z.discriminatedUnion('action', [
      z.object({ action: z.literal('start'), text: z.string().min(1).max(20_000) }),
      z.object({ action: z.literal('stop') }),
    ]),
    Ok,
  ),
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
};
