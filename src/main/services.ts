import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DEFAULT_PERSONA, personaPrompt } from '@shared/personas';
import { isDefaultName } from '@shared/assistant-name';
import {
  backupIfStale,
  backupNow,
  migrate,
  openDatabase,
  pendingMigrations,
  quickCheck,
  type Db,
} from './db/connection';
import { createConversationsRepo } from './db/repos/conversations-repo';
import { createRemindersRepo } from './db/repos/reminders-repo';
import { createSettingsRepo } from './db/repos/settings-repo';
import { createToolCallsRepo } from './db/repos/tool-calls-repo';
import { createUsageRepo } from './db/repos/usage-repo';
import { createAssistantStateHub } from './agent/assistant-state';
import { NO_PROVIDERS, createContextBuilder, type ContextProviders } from './agent/context-builder';
import { runAgentLoop } from './agent/agent-loop';
import { createOrchestrator, type Emit } from './agent/orchestrator';
import { createSdkLoop } from './agent/sdk-loop';
import { createBudgetGuard, dayShare } from './llm/budget-guard';
import { budgetAlertText, createBudgetAlerts } from './llm/budget-alerts';
import { createFallbackClient } from './llm/fallback-client';
import { createStrategyStore, learnFromTurn } from './agent/strategies';
import { createBrowserTrail } from './apps/browser-trail';
import { createGoalTools } from './planner/goals';
import { localDay } from './lib/util';
import { createClaudeClient } from './llm/claude-client';
import { createLocalClient } from './llm/local-client';
import { createBrains, createCloudClient } from './llm/brains';
import { createConnections } from './llm/connections';
import { createMultiRun } from './agent/multi-run';
import { createCliBrains, type CliBrain, type CliBrainId } from './llm/cli-brains';
import {
  createClaudeCodeClient,
  findClaudeCode,
  type ClaudeCodeRuntime,
  type QueryFn,
} from './llm/claude-code';
import { createFakeClaude, loadFakeScript } from './llm/fake-claude';
import type { LlmClient } from './llm/types';
import { createUsageLedger } from './llm/usage-ledger';
import { createCustomProviders } from './llm/pool/custom';
import { createFreePool, type Tier3Answer } from './llm/pool/pool';
import { createFusion } from './llm/pool/fusion';
import { createImageTool, createImages } from './llm/pool/images';
import { createFreeSearch, createFreeSearchTool } from './llm/pool/search';
import { privateBlock } from './agent/brain-runner';
import { randomUUID } from 'node:crypto';
import { logger } from './logging/logger';
import { createScheduler } from './scheduler/scheduler';
import { createAuditLog } from './security/audit';
import { createKillSwitch } from './security/kill-switch';
import { createPathGuard, defaultDeniedPaths } from './security/path-guard';
import { createPolicyEngine } from './security/policy-engine';
import { createSecretStore, type Encryptor } from './settings/secrets';
import { createSettingsService } from './settings/settings-service';
import { createConfirmationBroker, type ConfirmRequestEvent } from './tools/confirmation-broker';
import { createHuggingFaceTools } from './tools/everyday/hugging-face';
import { createUtilityTools } from './tools/everyday/utilities';
import { createToolExecutor } from './tools/executor';
import { createAppIndex } from './tools/native/app-index';
import { createNativeTools } from './tools/native/index';
import type { OsAdapter } from './tools/native/os';
import { createMealTools, createMealsRepo } from './tools/everyday/meals';
import { createKnowledgeTools } from './tools/everyday/knowledge';
import { createModeTools } from './tools/everyday/modes';
import { createMusicTools } from './tools/everyday/music';
import { createPlanLimitsStore } from './llm/plan-limits';
import {
  createSessionReader,
  createSessionWatcher,
  sdkSessionSource,
  type SessionSource,
} from './claude-sessions/sessions';
import { createClaudeSessionTools } from './claude-sessions/tools';
import { createScreenTools } from './tools/everyday/screen';
import { createWebPageTools } from './tools/everyday/web-page';
import { createYouTubeTools } from './tools/everyday/youtube';
import { createVideoTools } from './tools/everyday/video';
import { createWeatherTools } from './tools/everyday/weather';
import { createSkillStore } from './skills/skills';
import { createToolRegistry, type ToolScope } from './tools/registry';
import { createOutputStore, createSavedOutputTools } from './tools/saved-outputs';
import { createPlanner } from './planner/planner';
import { createPlannerTools } from './planner/planner-tools';
import { createLaya } from './laya/laya';
import { BUDGET_SHARE, createPoolTurns } from './agent/front-door';
import { createTerminal } from './apps/terminal';
import { LAYA_ACTIONS, createFastPath } from './agent/fast-path';

const LAYA_WARM_DELAY_MS = 5000;
/** Laya's front-door veto: anything but "general" sends the question to Claude. */
const FRONT_DOOR_KINDS = {
  general: 'a general question or chat that needs nothing about the person and no action',
  personal:
    'something about the person: their own data, files, messages, plans, people or memories',
  action: 'an action on the computer, its apps, devices or online accounts',
};
/** "Your local model is answering" is shown at most this often. */
const FALLBACK_NOTICE_MS = 10 * 60_000;

export interface ServiceOptions {
  userData: string;
  isTest: boolean;
  encryptor: Encryptor;
  emit: Emit;
  /** Windows/Electron access for native tools (a recording fake in tests). */
  os: OsAdapter;
  /** Dev-only fallbacks for secrets (e.g., ANTHROPIC_API_KEY from .env). Empty in packaged builds. */
  devSecrets?: Record<string, string>;
  llm?: LlmClient;
  /** Tests: stand-ins for the Agent SDK's query() and the claude.exe lookup (ADR-010). */
  claudeCodeQuery?: QueryFn;
  claudeCodePath?: () => string | null;
  /** Tests: stand-in for network requests made by tools (weather, feeds, Telegram). */
  fetch?: typeof fetch;
  /** Known folders (app.getPath) used to seed vault + allowed roots on first run. */
  paths: {
    documents: string;
    desktop: string;
    downloads: string;
    pictures: string;
    videos: string;
    music: string;
  };
  startMenuDirs?: string[];
  home?: string;
  /** Tests: stand-ins for the ChatGPT / Antigravity apps. */
  cliBrains?: Record<CliBrainId, CliBrain>;
  /** Tests: Claude Code sessions without reading ~/.claude. */
  claudeSessionSource?: SessionSource;
}

/** Database.md §7: a restore chosen in Settings is applied on the next start, before the DB is opened. */
function applyPendingRestore(userData: string): void {
  const marker = join(userData, 'restore-pending.json');
  if (!existsSync(marker)) return;
  try {
    const { file } = JSON.parse(readFileSync(marker, 'utf8')) as { file: string };
    const source = join(userData, 'backups', basename(file));
    if (existsSync(source)) {
      for (const ext of ['', '-wal', '-shm'])
        rmSync(join(userData, `jarvis.db${ext}`), { force: true });
      copyFileSync(source, join(userData, 'jarvis.db'));
      logger.warn({ file }, 'database restored from backup');
    }
  } finally {
    rmSync(marker, { force: true });
  }
}

function openDb(userData: string): { db: Db; healthy: boolean } {
  applyPendingRestore(userData);
  const file = join(userData, 'jarvis.db');
  const existed = existsSync(file);
  const db = openDatabase(file);
  const healthy = !existed || quickCheck(db);
  const backups = join(userData, 'backups');
  // Database.md §6: back up before applying migrations to an existing database.
  if (existed && healthy && pendingMigrations(db).length > 0) backupNow(db, backups);
  migrate(db);
  // Database.md §7: daily automatic backup, keep the last 7.
  if (existed && healthy) backupIfStale(db, backups);
  return { db, healthy };
}

/** API-Guide.md §10 defaults that depend on this machine's folders. */
function seedPathSettings(
  settings: ReturnType<typeof createSettingsService>,
  p: ServiceOptions['paths'],
): void {
  if (!settings.get('vault.path')) settings.set('vault.path', join(p.documents, 'JarvisBrain'));
  if (settings.get('files.allowedRoots').length === 0) {
    settings.set('files.allowedRoots', [
      p.desktop,
      p.documents,
      p.downloads,
      p.pictures,
      p.videos,
      p.music,
    ]);
  }
}

function defaultStartMenuDirs(): string[] {
  const programData = process.env['ProgramData'] ?? 'C:\\ProgramData';
  const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
  return [
    join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
}

/** Composition root for everything that does not need an Electron window (Code-style.md §4.3). */
export function createServices(opts: ServiceOptions) {
  mkdirSync(opts.userData, { recursive: true });
  const { db, healthy } = openDb(opts.userData);

  // ── settings, secrets, storage ───────────────────────────────────────────────────────────
  const settings = createSettingsService(createSettingsRepo(db));
  seedPathSettings(settings, opts.paths);
  // The UI follows the settings Jarvis changes himself (set_personality, quiet_mode); allowlist, so a
  // future sensitive key is never broadcast by default.
  settings.onChange((key, value) => {
    if (key === 'persona' || key === 'quiet.until') opts.emit('settings:changed', { key, value });
  });
  const secrets = createSecretStore(
    join(opts.userData, 'secrets.bin'),
    opts.encryptor,
    opts.devSecrets ?? {},
  );
  const conversations = createConversationsRepo(db);
  const toolCalls = createToolCallsRepo(db);
  const usageRepo = createUsageRepo(db);
  const reminders = createRemindersRepo(db);
  const audit = createAuditLog(db);

  // ── brain: usage, budget, state ──────────────────────────────────────────────────────────
  const subscription = (): boolean => settings.get('llm.provider') === 'subscription';
  // Heads-up at 50/75/90 % of the API budgets (idea from ruflo's cost tracker); quiet mode: toast only.
  const budgetAlerts = createBudgetAlerts({
    onAlert: (a) => {
      const text = budgetAlertText(a);
      if (settings.get('quiet.until') <= Date.now()) opts.os.notify('Budget', text);
      opts.emit('notify', { level: a.step >= 0.9 ? 'warn' : 'info', message: text });
    },
  });
  const ledger = createUsageLedger({
    repo: usageRepo,
    settings,
    // Another provider's API is paid per call too: it counts against the budgets like Anthropic's.
    billing: () => {
      const p = settings.get('llm.provider');
      return p === 'cloud' ? 'api' : p;
    },
    // Gateways' own listed prices (connections is created below; called only after start-up).
    livePrice: (conn, model) => connections.livePrice(conn, model),
    onUpdate: (u) => {
      opts.emit('usage:update', {
        dayCostUsd: u.dayCostUsd,
        monthCostUsd: u.monthCostUsd,
        // The status bar shows the conversation model, not background helpers.
        model: u.purpose === 'chat' ? u.model : '',
        dailyBudget: settings.get('budget.dailyUsd'),
      });
      // Budgets only limit API-key spend (ADR-010/013).
      if (settings.get('llm.provider') === 'api' || settings.get('llm.provider') === 'cloud')
        budgetAlerts.check(
          { day: localDay(new Date()), dayCostUsd: u.dayCostUsd, monthCostUsd: u.monthCostUsd },
          { daily: settings.get('budget.dailyUsd'), monthly: settings.get('budget.monthlyUsd') },
        );
    },
  });
  const budget = createBudgetGuard(ledger, settings);
  // Sub-agents on another provider's API spend money whatever Jarvis's own connection is.
  const paidBudget = createBudgetGuard(ledger, settings, () => true);
  // The free pool costs nothing: only the per-turn token ceiling applies (Security.md §16.15).
  const freeBudget = createBudgetGuard(ledger, settings, () => false);
  const killSwitch = createKillSwitch();
  const state = createAssistantStateHub();
  state.onChange((s, detail) =>
    opts.emit('assistant:state', { state: s, ...(detail ? { detail } : {}) }),
  );

  const llmApi: LlmClient =
    opts.llm ??
    (opts.isTest
      ? createFakeClaude(loadFakeScript(process.env['JARVIS_FAKE_SCRIPT']))
      : createClaudeClient(() => secrets.get('anthropic')));
  // ADR-010: Sir's own Claude Code (signed in with his plan), driven through the Agent SDK.
  const planLimits = createPlanLimitsStore();
  const claudeCode: ClaudeCodeRuntime = {
    onRateLimit: (info) => planLimits.record(info),
    path: opts.claudeCodePath ?? (() => findClaudeCode()),
    cwd: join(opts.userData, 'claude-code'),
    query: async () =>
      opts.claudeCodeQuery ?? (await import('@anthropic-ai/claude-agent-sdk')).query,
  };
  mkdirSync(claudeCode.cwd, { recursive: true });
  const llmSubscription = createClaudeCodeClient(claudeCode);
  // ADR-013: Ollama / LM Studio. Tool schemas come from the registry (it is created below).
  const llmLocal = createLocalClient({
    baseUrl: () => settings.get('llm.local.baseUrl'),
    model: () => settings.get('llm.local.model'),
    catalog: () => registry.catalog(),
    apiKey: () => secrets.get('local_llm'),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  // Claude busy or unreachable → the local model answers that call, if Sir turned it on (ruflo idea).
  let lastFallbackNotice = 0;
  const llmApiOrLocal = createFallbackClient({
    primary: llmApi,
    fallback: llmLocal,
    enabled: () => settings.get('llm.fallbackLocal') && settings.get('llm.local.model') !== '',
    onFallback: (err) => {
      logger.warn({ code: err.code }, 'Claude unavailable; local model answered');
      if (Date.now() - lastFallbackNotice < FALLBACK_NOTICE_MS) return;
      lastFallbackNotice = Date.now();
      opts.emit('notify', {
        level: 'info',
        message: 'Claude is unavailable right now, so your local model is answering.',
      });
    },
  });
  // Another provider's API (OpenAI, Gemini, DeepSeek…), through the same OpenAI-style translation.
  // Integrations step 3: several keys per provider and the models each offers.
  const connections = createConnections({ db, settings, secrets });
  const brainDeps = {
    settings,
    secrets,
    connections,
    catalog: () => registry.catalog(),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  };
  const llmCloud = createCloudClient(brainDeps, () => connections.main());
  const pickLlm = (): LlmClient => {
    const p = settings.get('llm.provider');
    if (p === 'subscription') return llmSubscription;
    if (p === 'local') return llmLocal;
    if (p === 'cloud') return llmCloud;
    return llmApiOrLocal;
  };
  /** Every Claude call goes to whichever connection Sir chose in Settings → Models & AI. */
  const llm: LlmClient = {
    stream: (req, o) => pickLlm().stream(req, o),
    ping: (model, signal) => pickLlm().ping(model, signal),
  };
  // Every AI Sir has set up, for sub-agents Jarvis sends to another brain.
  // Sir's ChatGPT / Google plans through their official apps. Tests never find the real apps.
  const cli =
    opts.cliBrains ??
    createCliBrains({
      workDir: join(opts.userData, 'cli-brains'),
      ...(opts.isTest ? { exists: () => false } : {}),
    });
  // AI Router (2.30): the free pool behind the "free" brain; tier 3 only after Sir says yes.
  const tier3Pending = new Map<string, (a: Tier3Answer) => void>();
  const pool = createFreePool({
    db,
    settings,
    secrets,
    connections,
    custom: createCustomProviders({ db, secrets }),
    catalog: () => registry.catalog(),
    ask: (q) =>
      new Promise<Tier3Answer>((resolve) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => finish('no'), 120_000);
        function finish(a: Tier3Answer): void {
          clearTimeout(timer);
          tier3Pending.delete(requestId);
          resolve(a);
        }
        tier3Pending.set(requestId, finish);
        opts.emit('pool:ask', { requestId, soonestMin: q.soonestMin, everyTime: q.everyTime });
      }),
    claudePrice: () => ledger.priceFor(settings.get('models.default')),
    abilities: () => ({
      search: freeSearch.status(),
      paidSearch: settings.get('web.search.enabled'),
      image: images.status(),
      voice: { ...voiceEngines },
    }),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  // AI Router Phase 3 (2.33, Security.md §16.15): free search, pictures, fusion; every path asks
  // the same privacy gate in code before anything leaves the PC.
  const freeSearch = createFreeSearch({
    settings,
    secrets,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const images = createImages({
    settings,
    secrets,
    connections,
    mayUseTier3: () => pool.mayUseTier3(),
    vaultRoot: () => settings.get('vault.path'),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const fusion = createFusion({ pool, settings });
  /** The speech engines in use right now (voice-controller sets them; the AI Router page shows them). */
  const voiceEngines: { hearing: string | null; speaking: string | null } = {
    hearing: null,
    speaking: null,
  };
  const searchGate = (w: { conversationId: string; private?: string | undefined }, text: string) =>
    privateBlock(db, w, text);
  /** Free search can take this turn: switched on, a provider free, nothing private in the chat. */
  const freeSearchFits = (scope: ToolScope): boolean =>
    freeSearch.usable() &&
    !searchGate(
      {
        conversationId: scope.conversationId,
        private: scope.taint.privateSource ?? scope.taint.privateData,
      },
      '',
    );
  const answerTier3 = (requestId: string, answer: Tier3Answer): void => {
    tier3Pending.get(requestId)?.(answer);
  };
  if (!opts.isTest) {
    // Key checks every `pool.checkHours` hours (a model-list call per key, no tokens).
    let lastCheck = 0;
    const timer = setInterval(() => {
      const hours = settings.get('pool.checkHours');
      if (!hours || Date.now() - lastCheck < hours * 3_600_000) return;
      lastCheck = Date.now();
      void pool.checkKeys().catch(() => undefined);
    }, 15 * 60_000);
    timer.unref?.();
  }
  const brains = createBrains({ ...brainDeps, jarvis: llm, local: llmLocal, cli, pool, fusion });
  // Integrations step 4: one request to several AIs, answers only.
  const multiRun = createMultiRun({
    db,
    brains,
    ledger,
    budget,
    paidBudget,
    settings,
    connections,
    emit: opts.emit,
  });
  const sdkLoop = createSdkLoop(claudeCode, {
    webSearchEnabled: () => settings.get('web.search.enabled'),
  });
  /** The agent loop for the current connection (Claude Code runs its own loop for the subscription). */
  const loopFor = (): typeof runAgentLoop => (subscription() ? sdkLoop : runAgentLoop);

  // ── safety layer (Security.md) ───────────────────────────────────────────────────────────
  const home = opts.home ?? homedir();
  const pathGuard = createPathGuard({
    allowedRoots: () =>
      [...settings.get('files.allowedRoots'), settings.get('vault.path')].filter(Boolean),
    deniedPaths: () => defaultDeniedPaths(home, opts.userData),
    homeDir: home,
  });
  const policy = createPolicyEngine({
    pathGuard,
    budgetExceeded: () => budget.isExceeded(),
    overrides: () => settings.get('policy.overrides'),
  });
  const confirmShowListeners = new Set<(e: ConfirmRequestEvent) => void>();
  const broker = createConfirmationBroker({
    emit: (e, p) => opts.emit(e, p),
    emitResolved: (p) => opts.emit('confirm:resolved', p),
    onShow: (e) => {
      for (const l of confirmShowListeners) l(e);
    },
  });

  // ── tools ────────────────────────────────────────────────────────────────────────────────
  const reminderListeners = new Set<(text: string, missed: boolean) => void>();
  const remindersChangedListeners = new Set<() => void>();
  const scheduler = createScheduler({
    repo: reminders,
    logger,
    onChange: () => {
      for (const l of remindersChangedListeners) l();
    },
    onFire: (r, missed) => deliverReminder(missed ? 'Missed reminder' : 'Reminder', r.text, missed),
  });
  /** One path for every reminder: Windows notification, in-app toast, and Jarvis says it (quiet mode: toast only). */
  function deliverReminder(title: string, text: string, missed = false): void {
    if (settings.get('quiet.until') <= Date.now()) opts.os.notify(title, text);
    opts.emit('notify', { level: 'info', message: `${title}: ${text}` });
    for (const l of reminderListeners) l(text, missed);
  }
  /** Jarvis speaking up on his own (Claude Code sessions): pop-up, toast and speech, quiet mode respected. */
  const announceListeners = new Set<(text: string) => void>();
  function announce(title: string, text: string): void {
    const quiet = settings.get('quiet.until') > Date.now();
    if (!quiet) opts.os.notify(title, text);
    opts.emit('notify', { level: 'info', message: text });
    if (!quiet) for (const l of announceListeners) l(text);
  }
  // Tasks and Calendar (PRD F25/F26): Jarvis can read and change both; reminders use the path above.
  const navListeners = new Set<(view: 'tasks' | 'calendar') => void>();
  const planner = createPlanner({
    db,
    logger,
    deliver: (title, text) => deliverReminder(title, text),
    onChange: () => opts.emit('planner:changed', {}),
  });
  const claudeSessions = createSessionReader(opts.claudeSessionSource ?? sdkSessionSource());
  const sessionWatcher = createSessionWatcher({
    reader: claudeSessions,
    level: () => settings.get('claudeCode.announce'),
    announce: (text) => announce('Claude Code', text),
    onError: (err) => logger.debug({ err: String(err) }, 'claude session poll failed'),
  });
  if (!opts.isTest) sessionWatcher.start();
  const appIndex = createAppIndex(opts.os, opts.startMenuDirs ?? defaultStartMenuDirs());
  const registry = createToolRegistry({
    // Claude's paid search only when free search can't take the turn (AI Router Phase 3).
    webSearchEnabled: (scope) =>
      settings.get('web.search.enabled') && (!scope || !freeSearchFits(scope)),
    freeSearchShown: (scope) =>
      scope ? freeSearchFits(scope) : settings.get('pool.abilities.search'),
  });
  for (const tool of createPlannerTools(planner, (view) => {
    opts.emit('nav:open', { view });
    for (const l of navListeners) l(view);
  }))
    registry.register(tool);
  // Long-term goals on top of Tasks (ruflo goals-plugin idea).
  for (const tool of createGoalTools(planner)) registry.register(tool);
  // Jarvis Terminal (ADR-032): Sir's own commands, plus every script Jarvis runs.
  const terminal = createTerminal({
    ps: (script, o) => opts.os.ps(script, o),
    audit: (command) => audit.append('user', 'terminal.run', { command: command.slice(0, 200) }),
  });
  for (const tool of createNativeTools({
    onShellRun: (script, r, ms) => terminal.record(script, r, ms),
    os: opts.os,
    appIndex,
    guard: pathGuard,
    scheduler,
    roots: () => settings.get('files.allowedRoots'),
    protectedPaths: () => [settings.get('vault.path')],
  }))
    registry.register(tool);
  // Everyday tools (ideas from isair/jarvis): weather, home town, meal log, look at the screen.
  const meals = createMealsRepo(db);
  for (const tool of [
    ...createWeatherTools({ settings, ...(opts.fetch ? { fetch: opts.fetch } : {}) }),
    ...createMealTools({ repo: meals, settings }),
    ...createScreenTools(opts.os, opts.paths.pictures),
    // Ideas from smaller Jarvis projects on GitHub: Wikipedia, dictionary, distance; personality, quiet mode.
    ...createKnowledgeTools(opts.fetch ? { fetch: opts.fetch } : {}),
    ...createModeTools({ settings }),
    ...createWebPageTools(opts.fetch ? { fetch: opts.fetch } : {}),
    // YouTube transcripts without an API key (idea from jo-inc/camofox-browser).
    ...createYouTubeTools(opts.fetch ? { fetch: opts.fetch } : {}),
    // AI Router Phase 3: free search APIs and free image models, private data never sent.
    createFreeSearchTool({ search: freeSearch, gate: searchGate }),
    createImageTool({ images, gate: searchGate }),
    // Videos from HTML with HyperFrames (heygen-com/hyperframes), rendered on this PC.
    ...createVideoTools({ videosDir: () => join(opts.paths.videos, 'Jarvis') }),
    // HuggingGPT (microsoft/JARVIS): Claude plans, picks Hub models, runs them, explains.
    ...createHuggingFaceTools({
      token: () => secrets.get('huggingface'),
      guard: pathGuard,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    }),
    // Music from Sir's own library (kishanrajput23/Jarvis-Desktop-Voice-Assistant).
    ...createMusicTools({ os: opts.os, guard: pathGuard, musicDir: () => opts.paths.music }),
    // Claude Code sessions, plan usage and new sessions by voice (ethanplusai/jarvis).
    ...createClaudeSessionTools({
      reader: claudeSessions,
      planLimits: () => planLimits.get(),
      claudePath: () => claudeCode.path(),
      guard: pathGuard,
      reaConfigDir: join(opts.userData, 'claude-code'),
    }),
    // Everyday plugins (sukeesh/Jarvis): currency, markets, network, passwords, folder tidy.
    ...createUtilityTools({
      os: opts.os,
      guard: pathGuard,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    }),
  ])
    registry.register(tool);
  // Long tool results stay searchable instead of being cut off (idea from mksglu/context-mode).
  const outputs = createOutputStore();
  for (const tool of createSavedOutputTools(outputs)) registry.register(tool);
  const tools = createToolExecutor({
    registry,
    policy,
    broker,
    toolCalls,
    outputs,
    audit,
    state,
    emit: (e, p) => opts.emit(e, p),
    logger,
  });

  // Later phases plug memory providers in through this slot.
  // Skills (OpenJarvis / agentskills.io): listed in context, loaded on demand with use_skill.
  const skills = createSkillStore({
    root: join(opts.userData, 'skills'),
    settings,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  let skillSummary = '';
  const refreshSkills = (): Promise<void> =>
    skills
      .summary()
      .then((x) => {
        skillSummary = x;
      })
      .catch(() => undefined);
  void refreshSkills();
  settings.onChange((key) => {
    if (key === 'skills.disabled') void refreshSkills();
  });
  for (const tool of skills.tools()) registry.register(tool);
  // Approaches that worked (ruflo ReasoningBank idea): learned after turns, offered as hints.
  const strategies = createStrategyStore(db);
  // Jarvis Browser steps that worked, per conversation, for save_browser_routine (ruflo idea).
  const browserTrail = createBrowserTrail();
  const slots: { providers: ContextProviders } = {
    providers: { ...NO_PROVIDERS, skills: () => skillSummary },
  };
  const providers: ContextProviders = {
    coreProfile: () => slots.providers.coreProfile(),
    retrieve: (t) => slots.providers.retrieve(t),
    integrations: () => {
      // Jarvis decides which AI does what: he needs to know which ones Sir set up.
      const others = brains
        .available()
        .filter(
          (b) =>
            b !== 'jarvis' &&
            ((b !== 'free' && b !== 'fusion') || settings.get('pool.delegation.delegate')),
        );
      const line = others.length
        ? `other AIs for delegate_task "brain": ${others.map((b) => `${brains.label(b)} (${b})`).join(', ')}`
        : '';
      // AI Router Phase 2: nearly out of budget → push heavy non-private work to the free pool.
      const tight =
        others.includes('free') &&
        settings.get('pool.delegation.budgetAware') &&
        dayShare(ledger, settings) >= BUDGET_SHARE
          ? `today's Claude budget is over 80% used: hand every heavy job with none of Sir's private data to brain "free"`
          : '';
      const chains = others.includes('free') ? settings.get('pool.chains') : [];
      const chainLine = chains.length
        ? `free-pool chains for delegate_task "chain": ${chains.map((c) => c.name).join(', ')}`
        : '';
      return [slots.providers.integrations(), line, chainLine, tight].filter(Boolean).join('; ');
    },
    allowedRoots: () => settings.get('files.allowedRoots'),
    screenCount: () => slots.providers.screenCount(),
    routines: () => slots.providers.routines(),
    skills: () => slots.providers.skills(),
    persona: () => {
      const p = settings.get('persona');
      return p === DEFAULT_PERSONA ? '' : personaPrompt(p);
    },
    assistantName: () => {
      const n = settings.get('assistant.name');
      return isDefaultName(n) ? '' : n;
    },
    moodTags: () => settings.get('appearance.orbMood'),
    approaches: (t) => strategies.hint(t),
  };
  const context = createContextBuilder({ conversations, providers });
  const laya = createLaya({
    modelDir: join(opts.userData, 'models', 'laya-multilingual'),
    // Laya's labels say "Jarvis": with another name it would drop real requests, so it steps aside.
    mode: () =>
      opts.isTest || !isDefaultName(settings.get('assistant.name'))
        ? 'off'
        : settings.get('laya.mode'),
    fastPath: () => !opts.isTest && settings.get('agent.fastCommands') === 'laya',
    logger,
  });
  settings.onChange((key) => {
    if (key === 'laya.mode' || key === 'agent.fastCommands') laya.warm();
  });
  const layaChoices = Object.fromEntries(
    Object.entries(LAYA_ACTIONS).map(([k, v]) => [k, v.criteria]),
  );
  const fastPath = createFastPath({
    mode: () => settings.get('agent.fastCommands'),
    classify: (text) => laya.classify(text, layaChoices),
    assistantName: () => settings.get('assistant.name'),
    logger,
  });
  // AI Router Phase 2: front door and fallback turns on the free pool (agent/front-door.ts).
  const poolTurns = createPoolTurns({
    db,
    conversations,
    pool,
    tools: () => tools,
    budget: freeBudget,
    claudeBudget: budget,
    ledger,
    settings,
    dayShare: () => dayShare(ledger, settings),
    // Laya (when loaded) may only send a front-door question back to Claude, never approve one.
    veto: async (text) => {
      const p = await laya.classify(text, FRONT_DOOR_KINDS);
      return !!p && (p['general'] ?? 0) < Math.max(p['personal'] ?? 0, p['action'] ?? 0);
    },
  });
  // Loaded after startup settles so the first voice or chat decision can use it.
  setTimeout(() => laya.warm(), LAYA_WARM_DELAY_MS).unref();

  const orchestrator = createOrchestrator({
    conversations,
    toolCalls,
    context,
    llm: () => llm,
    tools: () => tools,
    loop: loopFor,
    budget,
    ledger,
    settings,
    killSwitch,
    state,
    emit: opts.emit,
    logger,
    fastPath,
    poolTurns,
  });

  orchestrator.onTurnEnd((turn) => learnFromTurn(strategies, turn));

  // Security.md §11: the kill switch stops turns, denies pending confirmations and returns to IDLE.
  killSwitch.onKill((reason) => {
    orchestrator.cancel();
    multiRun.cancelAll();
    broker.denyAll();
    state.set('IDLE');
    audit.append(
      reason === 'ui' || reason === 'hotkey' || reason === 'tray' ? 'user' : 'system',
      'killswitch',
      { reason },
    );
    opts.emit('notify', { level: 'info', message: 'All activity stopped.' });
  });

  return {
    db,
    dbHealthy: healthy,
    userData: opts.userData,
    isTest: opts.isTest,
    emit: opts.emit,
    os: opts.os,
    settings,
    secrets,
    conversations,
    toolCalls,
    usageRepo,
    reminders,
    audit,
    ledger,
    budget,
    killSwitch,
    state,
    llm,
    llmApi,
    llmLocal,
    llmCloud,
    connections,
    multiRun,
    /** A client for one connection (model lists and tests in Settings; no model needed to list). */
    connectionClient: (id: string) => createCloudClient(brainDeps, () => id),
    brains,
    pool,
    freeSearch,
    images,
    fusion,
    voiceEngines,
    searchGate,
    answerTier3,
    paidBudget,
    freeBudget,
    claudeCode,
    planLimits,
    skills,
    refreshSkills,
    fetch: opts.fetch,
    loopFor,
    meals,
    pathGuard,
    policy,
    broker,
    registry,
    tools,
    scheduler,
    appIndex,
    reminderListeners,
    announceListeners,
    sessionWatcher,
    remindersChangedListeners,
    confirmShowListeners,
    planner,
    navListeners,
    context,
    orchestrator,
    laya,
    slots,
    terminal,
    browserTrail,
  };
}

export type Services = ReturnType<typeof createServices>;
