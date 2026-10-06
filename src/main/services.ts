import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
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
import { createOrchestrator, type Emit } from './agent/orchestrator';
import { createBudgetGuard } from './llm/budget-guard';
import { createClaudeClient } from './llm/claude-client';
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
import { createToolExecutor } from './tools/executor';
import { createAppIndex } from './tools/native/app-index';
import { createNativeTools } from './tools/native/index';
import type { OsAdapter } from './tools/native/os';
import { createToolRegistry } from './tools/registry';

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

function openDb(userData: string): { db: Db; healthy: boolean } {
  const file = join(userData, 'jarvis.db');
  const existed = existsSync(file);
  const db = openDatabase(file);
  const healthy = !existed || quickCheck(db);
  // Database.md §6: back up before applying migrations to an existing database.
  if (existed && healthy && pendingMigrations(db).length > 0)
    backupNow(db, join(userData, 'backups'));
  migrate(db);
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
  const ledger = createUsageLedger({
    repo: usageRepo,
    settings,
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

  const llm: LlmClient =
    opts.llm ??
    (opts.isTest
      ? createFakeClaude(loadFakeScript(process.env['JARVIS_FAKE_SCRIPT']))
      : createClaudeClient(() => secrets.get('anthropic')));

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
    onFire: (r, missed) => {
      opts.os.notify(missed ? 'Missed reminder' : 'Reminder', r.text);
      opts.emit('notify', {
        level: 'info',
        message: `${missed ? 'Missed reminder' : 'Reminder'}: ${r.text}`,
      });
      for (const l of reminderListeners) l(r.text, missed);
    },
  });
  const appIndex = createAppIndex(opts.os, opts.startMenuDirs ?? defaultStartMenuDirs());
  const registry = createToolRegistry({
    webSearchEnabled: () => settings.get('web.search.enabled'),
  });
  for (const tool of createNativeTools({
    os: opts.os,
    appIndex,
    guard: pathGuard,
    scheduler,
    roots: () => settings.get('files.allowedRoots'),
    protectedPaths: () => [settings.get('vault.path')],
  }))
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
  const slots: { providers: ContextProviders } = { providers: NO_PROVIDERS };
  const providers: ContextProviders = {
    coreProfile: () => slots.providers.coreProfile(),
    retrieve: (t) => slots.providers.retrieve(t),
    integrations: () => slots.providers.integrations(),
    allowedRoots: () => settings.get('files.allowedRoots'),
    screenCount: () => slots.providers.screenCount(),
    routines: () => slots.providers.routines(),
  };
  const context = createContextBuilder({ conversations, providers });

  const orchestrator = createOrchestrator({
    conversations,
    toolCalls,
    context,
    llm: () => llm,
    tools: () => tools,
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
    context,
    orchestrator,
    slots,
  };
}

export type Services = ReturnType<typeof createServices>;
