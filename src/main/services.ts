import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
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
import { createBudgetGuard } from './llm/budget-guard';
import { createClaudeClient } from './llm/claude-client';
import { createLocalClient } from './llm/local-client';
import {
  createClaudeCodeClient,
  findClaudeCode,
  type ClaudeCodeRuntime,
  type QueryFn,
} from './llm/claude-code';
import { createFakeClaude, loadFakeScript } from './llm/fake-claude';
import type { LlmClient } from './llm/types';
import { createUsageLedger } from './llm/usage-ledger';
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
import { createScreenTools } from './tools/everyday/screen';
import { createWebPageTools } from './tools/everyday/web-page';
import { createWeatherTools } from './tools/everyday/weather';
import { createSkillStore } from './skills/skills';
import { createToolRegistry } from './tools/registry';
import { createPlanner } from './planner/planner';
import { createPlannerTools } from './planner/planner-tools';

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
  const ledger = createUsageLedger({
    repo: usageRepo,
    settings,
    billing: () => settings.get('llm.provider'),
    onUpdate: (u) =>
      opts.emit('usage:update', {
        dayCostUsd: u.dayCostUsd,
        monthCostUsd: u.monthCostUsd,
        // The status bar shows the conversation model, not background helpers.
        model: u.purpose === 'chat' ? u.model : '',
        dailyBudget: settings.get('budget.dailyUsd'),
      }),
  });
  const budget = createBudgetGuard(ledger, settings);
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
  const claudeCode: ClaudeCodeRuntime = {
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
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const pickLlm = (): LlmClient => {
    const p = settings.get('llm.provider');
    return p === 'subscription' ? llmSubscription : p === 'local' ? llmLocal : llmApi;
  };
  /** Every Claude call goes to whichever connection Sir chose in Settings → Models & budget. */
  const llm: LlmClient = {
    stream: (req, o) => pickLlm().stream(req, o),
    ping: (model, signal) => pickLlm().ping(model, signal),
  };
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
  /** One path for every reminder: Windows notification, in-app toast, and Jarvis says it. */
  function deliverReminder(title: string, text: string, missed = false): void {
    opts.os.notify(title, text);
    opts.emit('notify', { level: 'info', message: `${title}: ${text}` });
    for (const l of reminderListeners) l(text, missed);
  }
  // Tasks and Calendar (PRD F25/F26): Jarvis can read and change both; reminders use the path above.
  const navListeners = new Set<(view: 'tasks' | 'calendar') => void>();
  const planner = createPlanner({
    db,
    logger,
    deliver: (title, text) => deliverReminder(title, text),
    onChange: () => opts.emit('planner:changed', {}),
  });
  const appIndex = createAppIndex(opts.os, opts.startMenuDirs ?? defaultStartMenuDirs());
  const registry = createToolRegistry({
    webSearchEnabled: () => settings.get('web.search.enabled'),
  });
  for (const tool of createPlannerTools(planner, (view) => {
    opts.emit('nav:open', { view });
    for (const l of navListeners) l(view);
  }))
    registry.register(tool);
  for (const tool of createNativeTools({
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
    ...createScreenTools(opts.os),
    ...createWebPageTools(opts.fetch ? { fetch: opts.fetch } : {}),
    // HuggingGPT (microsoft/JARVIS): Claude plans, picks Hub models, runs them, explains.
    ...createHuggingFaceTools({
      token: () => secrets.get('huggingface'),
      guard: pathGuard,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    }),
    // Everyday plugins (sukeesh/Jarvis): currency, markets, network, passwords, folder tidy.
    ...createUtilityTools({
      os: opts.os,
      guard: pathGuard,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    }),
  ])
    registry.register(tool);
  const tools = createToolExecutor({
    registry,
    policy,
    broker,
    toolCalls,
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
  const slots: { providers: ContextProviders } = {
    providers: { ...NO_PROVIDERS, skills: () => skillSummary },
  };
  const providers: ContextProviders = {
    coreProfile: () => slots.providers.coreProfile(),
    retrieve: (t) => slots.providers.retrieve(t),
    integrations: () => slots.providers.integrations(),
    allowedRoots: () => settings.get('files.allowedRoots'),
    screenCount: () => slots.providers.screenCount(),
    routines: () => slots.providers.routines(),
    skills: () => slots.providers.skills(),
  };
  const context = createContextBuilder({ conversations, providers });

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
  });

  // Security.md §11: the kill switch stops turns, denies pending confirmations and returns to IDLE.
  killSwitch.onKill((reason) => {
    orchestrator.cancel();
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
    claudeCode,
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
    remindersChangedListeners,
    confirmShowListeners,
    planner,
    navListeners,
    context,
    orchestrator,
    slots,
  };
}

export type Services = ReturnType<typeof createServices>;
