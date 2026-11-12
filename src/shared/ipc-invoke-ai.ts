import { z } from 'zod';
import { SETTING_KEYS, type SettingKey } from './settings';
import { ConversationSummarySchema, SecretNameSchema, UiMessageSchema } from './types';
import { BrainRefSchema, CLOUD_PROVIDER_IDS } from './llm-providers';
import { RunEstimateSchema, RunRequestSchema, RunViewSchema } from './ai-runs';
import {
  ANALYTICS_RANGES,
  CUSTOM_ID_RE,
  IMAGE_SIZES,
  LIVE_STRATEGIES,
  MAX_CHAINS,
  PoolAbilitySettingsSchema,
  PoolAnalyticsSchema,
  PoolChainSchema,
  PoolDelegationSchema,
  PoolSnapshotSchema,
  ScoreWeightsSchema,
} from './free-pool';
import { AGENT_CLI_IDS } from './agent-clis';
import {
  AiConnectionSchema,
  AttachmentSchema,
  ConnId,
  CustomProviderInput,
  Empty,
  ForgeMessageSchema,
  ForgePath,
  ForgeRunViewSchema,
  Id,
  Label,
  OfflineProblemSchema,
  Ok,
  RunId,
  contract,
} from './ipc-schemas';

/** Chat, conversations, models and connections, the AI Router and Forge. Part of INVOKE (ipc-contract.ts puts the parts together and checks none is missing). */
export const INVOKE_AI = {
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
  'conversations:rename': contract(
    z.object({ id: Id, title: z.string().trim().min(1).max(120) }),
    Ok,
  ),
  'conversations:pin': contract(z.object({ id: Id, pinned: z.boolean() }), Ok),
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
  /** This PC's RAM and free disk, for "which colibri model fits" (shared/colibri.ts). */
  /** Offline mode (src/main/offline.ts): what stops it, and turning it on (only when nothing does). */
  'offline:status': contract(
    Empty,
    z.object({ enabled: z.boolean(), problems: z.array(OfflineProblemSchema) }),
  ),
  'offline:set': contract(
    z.object({ enabled: z.boolean() }).strict(),
    z.object({ ok: z.boolean(), problems: z.array(OfflineProblemSchema) }),
  ),
  'llm:hardware': contract(
    Empty,
    z.object({ ramGb: z.number(), freeDiskGb: z.number(), cpuCores: z.number() }),
  ),
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
  /** F9: the Forge chat. Sir's message is saved and returned; the desk's reply arrives as forge:message. */
  'forge:messages': contract(Empty, z.array(ForgeMessageSchema)),
  'forge:send': contract(
    z.object({ text: z.string().trim().min(1).max(8000) }),
    ForgeMessageSchema,
  ),
  /** F10: Forge's memory, notebooks and chats (read-only from the page). */
  'forge:files': contract(
    z.object({ dir: ForgePath.optional() }),
    z.array(z.object({ path: z.string(), name: z.string(), isDir: z.boolean(), size: z.number() })),
  ),
  /** F12: what a real Forge run needs on this PC, each with a fix (read-only). */
  'forge:readiness': contract(
    Empty,
    z.array(
      z.object({
        id: z.enum(['repo', 'node', 'git', 'claude', 'vault', 'workers', 'budget']),
        label: z.string(),
        state: z.enum(['ok', 'warn', 'missing']),
        detail: z.string(),
        fix: z.string(),
        required: z.boolean(),
      }),
    ),
  ),
  /** F12: post the suggested first build (fixed text) to the Forge chat as Sir's message. */
  'forge:firstRun': contract(Empty, ForgeMessageSchema),
  'forge:file': contract(
    z.object({ path: ForgePath }),
    z.object({ path: z.string(), markdown: z.string() }),
  ),
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
        id: z.enum(['chatgpt', 'antigravity', 'opencode']),
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
  'llm:cliLogin': contract(z.object({ id: z.enum(['chatgpt', 'antigravity', 'opencode']) }), Ok),
  'llm:cliTest': contract(
    z.object({ id: z.enum(['chatgpt', 'antigravity', 'opencode']) }),
    z.object({ ok: z.boolean(), error: z.string().optional() }),
  ),
  'location:detect': contract(Empty, z.object({ town: z.string() })),
};
