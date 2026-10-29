import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  Notification,
  app,
  clipboard,
  desktopCapturer,
  safeStorage,
  screen,
  shell,
  type BrowserWindow,
  type Tray,
} from 'electron';
import type { SettingKey } from '@shared/settings';
import { addEventTarget, emit, onEmit } from './ipc/emit';
import { registerCoreHandlers } from './ipc/handlers/core';
import { registerMemoryHandlers, writeQuickFacts } from './ipc/handlers/memory';
import { registerSafetyHandlers } from './ipc/handlers/safety';
import { registerAiConnectionHandlers } from './ipc/handlers/ai-connections';
import { registerRunHandlers } from './ipc/handlers/runs';
import { registerPoolHandlers } from './ipc/handlers/pool';
import { registerPasswordHandlers } from './ipc/handlers/passwords';
import { registerSpacesHandlers } from './ipc/handlers/spaces';
import { registerPlannerHandlers } from './ipc/handlers/planner';
import { createSpaces, createSpacesTool } from './spaces/spaces';
import { createStageTools } from './stage/stage-tools';
import { createMemorySystem } from './memory/memory-system';
import { createResearchTool } from './agent/research';
import { createSubagentTool } from './agent/subagents';
import { createAutomation } from './automation/automation';
import { createTelegramChannel } from './channels/telegram';
import { copilotTool, createCopilot } from './copilot/copilot';
import { registerCopilotHandlers } from './ipc/handlers/copilot';
import { registerTelegramHandlers } from './ipc/handlers/telegram';
import { registerRemoteHandlers } from './ipc/handlers/remote';
import { createPhoneRemote } from './channels/phone-remote';
import { createWhatsAppChannel } from './channels/whatsapp';
import { registerWhatsAppHandlers } from './ipc/handlers/whatsapp';
import { registerAutomationHandlers } from './ipc/handlers/automation';
import { registerAppHandlers } from './ipc/handlers/apps';
import { createAppTools } from './apps/app-tools';
import { createJarvisBrowser } from './apps/browser-window';
import { createTerminalWindow } from './apps/terminal-window';
import { createCameraView } from './apps/camera-view';
import { createDock } from './apps/dock';
import { JARVIS_APP_INFO } from '@shared/jarvis-apps';
import type { StagePanel } from '@shared/stage';
import { registerSkillHandlers } from './ipc/handlers/skills';
import { registerNpcHandlers } from './ipc/handlers/npcs';
import { createNpcRepo } from './npcs/npc-repo';
import { createNpcRuntime } from './npcs/npc-runtime';
import { createNpcTools } from './npcs/npc-tools';
import { registerVoiceHandlers } from './ipc/handlers/voice';
import { createVoiceSystem } from './voice/voice-system';
import { startupFacts, startupLine } from './voice/greetings';
import { registerMcpHandlers } from './ipc/handlers/mcp';
import { createMcpSystem } from './mcp/mcp-system';
import { createComputerSystem } from './tools/computer/computer-system';
import { createElectronScreen } from './tools/computer/electron-screen';
import { createFakeDriver, createFakeScreen, createNutDriver } from './tools/computer/drivers';
import { createComputerOverlay } from './windows/overlay-window';
import { createMiniOrb, type MiniOrb } from './windows/mini-window';
import { createCaptureWindow } from './windows/capture-window';
import { createCameraTools } from './tools/everyday/camera';
import { applyRetention, registerDataHandlers } from './ipc/handlers/data';
import { handle } from './ipc/handle';
import { JarvisError, errorMessage } from './errors';
import { initFileLogging, logger } from './logging/logger';
import { createServices, type Services } from './services';
import { createFakeOs, createWindowsOs } from './tools/native/os';
import { hardenSession } from './windows/hardening';
import { registerHotkeys, unregisterHotkeys } from './windows/hotkeys';
import { createMainWindow, TITLE_BAR_HEIGHT } from './windows/main-window';
import { createMusicMeter } from './windows/music-meter';
import { createTray, iconPath } from './windows/tray';

const isTest = process.env['JARVIS_TEST'] === '1';
/** The startup hello waits this long after the window loads, so the app has settled first. */
const STARTUP_GREETING_DELAY_MS = 1500;
if (process.env['JARVIS_USER_DATA']) app.setPath('userData', process.env['JARVIS_USER_DATA']);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

let miniOrb: MiniOrb | null = null;

/** Design-system.md §4.3 mini orb: hides the main window and shows a small always-on-top orb (or back). */
function setMiniMode(on: boolean): void {
  if (on) {
    const win = miniOrb?.window();
    if (!win || win.isDestroyed()) {
      const created = miniOrb?.create();
      if (created) {
        addEventTarget(created);
        created.once('ready-to-show', () => created.showInactive());
      }
    } else win.showInactive();
    mainWindow?.hide();
  } else {
    miniOrb?.window()?.hide();
    showMainWindow();
  }
}

/** PRD F6.4 start with Windows (packaged builds only; dev builds would register electron.exe). */
function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

/** Push-to-talk listeners (the voice controller registers one in Phase 4). */
export const pttHandlers = new Set<() => void>();
/** Optional feature hotkeys (dictation, reply copilot): setting key → when enabled → action. */
const extraHotkeys: Array<{ key: SettingKey; enabled(): boolean; fn(): void }> = [];

/** Dev convenience only: ANTHROPIC_API_KEY from the repo's .env (never in packaged builds). */
function devSecrets(): Record<string, string> {
  if (app.isPackaged || isTest) return {};
  const file = join(app.getAppPath(), '.env');
  if (!existsSync(file)) return {};
  const m = /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync(file, 'utf8'));
  return m?.[1]?.trim() ? { anthropic: m[1].trim() } : {};
}

function knownFolders(userData: string) {
  const names = ['documents', 'desktop', 'downloads', 'pictures', 'videos', 'music'] as const;
  // Test runs get a sandboxed fake home so they never touch Sir's real folders.
  return Object.fromEntries(
    names.map((n) => {
      if (!isTest) return [n, app.getPath(n)];
      const dir = join(userData, 'home', n);
      mkdirSync(dir, { recursive: true });
      return [n, dir];
    }),
  ) as Record<(typeof names)[number], string>;
}

export function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow(): void {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showMainWindow();
}

function osAdapter() {
  if (isTest) return createFakeOs();
  return createWindowsOs({
    shell,
    clipboard,
    captureScreen: async (maxWidth) => {
      const d = screen.getPrimaryDisplay();
      const size = {
        width: Math.round(d.bounds.width * d.scaleFactor),
        height: Math.round(d.bounds.height * d.scaleFactor),
      };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      const src = sources.find((x) => x.display_id === String(d.id)) ?? sources[0];
      if (!src) throw new Error('No screen available to capture.');
      const img = src.thumbnail;
      return img.getSize().width > maxWidth
        ? img.resize({ width: maxWidth, quality: 'good' }).toPNG()
        : img.toPNG();
    },
    notify: (title, body) => {
      const n = new Notification({ title, body, icon: iconPath() });
      n.on('click', showMainWindow);
      n.show();
    },
  });
}

function wireWindowBehaviour(s: Services): void {
  if (!mainWindow) return;
  mainWindow.on('close', (e) => {
    // App-flow.md §13: closing the window minimises to the tray unless Sir chose "quit on close".
    if (!quitting && s.settings.get('app.closeToTray') && !isTest) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  // Design-system.md §5.5: if a confirmation arrives while hidden, show the window and flash the taskbar.
  s.confirmShowListeners.add(() => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) showMainWindow();
    if (!mainWindow.isFocused()) mainWindow.flashFrame(true);
  });
}

function wireHotkeysAndTray(s: Services): void {
  const bind = (): void => {
    if (isTest) return; // Testing.md §2: no real global hotkeys in test runs.
    const failed = registerHotkeys(
      {
        kill: s.settings.get('hotkeys.kill'),
        toggleWindow: s.settings.get('hotkeys.toggleWindow'),
        ptt: s.settings.get('hotkeys.ptt'),
      },
      {
        kill: () => s.killSwitch.trigger('hotkey'),
        toggleWindow: toggleMainWindow,
        ptt: () => pttHandlers.forEach((h) => h()),
      },
      extraHotkeys
        .filter((x) => x.enabled())
        .map((x) => ({ accel: s.settings.get(x.key) as string, fn: x.fn })),
    );
    if (failed.length)
      emit('notify', {
        level: 'warn',
        message: `These shortcuts are used by another app: ${failed.join(', ')}. Change them in Settings → Hotkeys.`,
      });
  };
  bind();
  s.settings.onChange((key) => {
    if (key.startsWith('hotkeys.') || key.endsWith('.enabled')) bind();
  });
  if (isTest) return;
  tray = createTray({
    show: showMainWindow,
    stopEverything: () => s.killSwitch.trigger('tray'),
    miniMode: () => setMiniMode(true),
    toggleVoice: () =>
      s.settings.set('voice.mode', s.settings.get('voice.mode') === 'off' ? 'ptt' : 'off'),
    voiceEnabled: () => s.settings.get('voice.mode') !== 'off',
    openSettings: () => {
      showMainWindow();
      emit('nav:open', { view: 'settings' });
    },
    quit: () => {
      quitting = true;
      app.quit();
    },
  });
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData');
  await initFileLogging(join(userData, 'logs'));
  hardenSession();

  const services = createServices({
    userData,
    isTest,
    encryptor: safeStorage,
    emit,
    os: osAdapter(),
    devSecrets: devSecrets(),
    paths: knownFolders(userData),
    ...(isTest ? { home: join(userData, 'home') } : {}),
  });
  if (!services.dbHealthy) logger.error('database failed quick_check');
  const memory = createMemorySystem(services);
  // Hidden window for the echo-cancelled microphone and the webcam (windows/capture-window.ts).
  const capture = createCaptureWindow(logger);
  app.on('will-quit', () => capture.destroy());
  const voice = createVoiceSystem(services, isTest ? {} : { capture });
  for (const tool of createCameraTools({ snapshot: () => capture.snapshot() }))
    services.registry.register(tool);
  const mcp = createMcpSystem(services, { appVersion: app.getVersion() });
  app.on('will-quit', () => void mcp.manager.shutdown());
  pttHandlers.add(() => voice.voice.ptt());
  extraHotkeys.push({
    key: 'hotkeys.dictation',
    enabled: () => services.settings.get('dictation.enabled'),
    fn: () => voice.voice.dictate(),
  });
  app.on('will-quit', () => voice.voice.shutdown());
  const startMemory = (): void => {
    memory.start().catch((err: unknown) => {
      logger.error({ err: errorMessage(err) }, 'memory start failed');
      emit('notify', {
        level: 'error',
        message: `The memory vault could not be opened: ${errorMessage(err)}`,
        action: 'memory',
      });
    });
  };
  registerCoreHandlers(services, {
    audit: (event, details) => services.audit.append('user', event, details),
    onOnboarded: async (_vaultPath, facts) => {
      await memory.start();
      await writeQuickFacts(memory, facts);
      await voice.start();
      void mcp.manager.start();
    },
  });
  registerSafetyHandlers(services);
  registerAiConnectionHandlers(services);
  registerRunHandlers(services);
  registerPoolHandlers(services);
  registerPasswordHandlers(services);
  registerMemoryHandlers(services, memory);
  // Spaces (Notion-style notebooks) live in the vault so memory search and the Brain graph see them.
  const spaces = createSpaces({
    vault: memory.vault,
    settings: services.settings,
    onChanged: (paths) => emit('memory:changed', { vaultPaths: paths }),
  });
  registerSpacesHandlers(spaces, { show: showMainWindow });
  services.registry.register(createSpacesTool(spaces));
  for (const tool of createStageTools(
    (panel) => emit('stage:panel', { panel }),
    services.pathGuard,
  ))
    services.registry.register(tool);
  registerVoiceHandlers(
    services,
    voice.voice,
    {
      setActiveConversation: voice.setActiveConversation,
      isTest,
      mic: voice.mic,
    },
    {
      models: voice.local.models,
      // A downloaded model may be the memory embedder: start indexing right away.
      changed: () => {
        voice.local.changed();
        void memory.semantic.sync();
      },
    },
    voice.dictations,
    voice.voiceMatch,
  );
  registerMcpHandlers(services, mcp.manager);
  const overlay = createComputerOverlay();
  app.on('will-quit', () => overlay.destroy());
  const computer = createComputerSystem(services, {
    screen: isTest ? createFakeScreen() : createElectronScreen((w) => !overlay.isBorder(w)),
    driver: isTest ? async () => createFakeDriver() : createNutDriver,
    overlay,
    mainWindow: {
      minimize: () => mainWindow?.minimize(),
      restore: () => {
        if (mainWindow?.isMinimized()) mainWindow.restore();
      },
    },
  });
  handle('computer:calibrate', () => computer.calibrate());
  registerDataHandlers(services);
  registerSkillHandlers(services);
  // NPCs: Sir's team of single-purpose agents; Jarvis leads them (npc_* tools) and reads their memory.
  const npcRepo = createNpcRepo(services.db);
  const npcs = createNpcRuntime({ s: services, repo: npcRepo, vault: () => memory.vault, emit });
  for (const tool of createNpcTools(npcs, npcRepo)) services.registry.register(tool);
  registerNpcHandlers(services, npcs, npcRepo);
  const integrations = services.slots.providers.integrations;
  services.slots.providers = {
    ...services.slots.providers,
    integrations: () => {
      const team = npcRepo.list().filter((n) => n.enabled);
      const line = team.length
        ? `your NPC team (npc_ask / npc_meeting): ${team.map((n) => `${n.name} (${n.role})`).join(', ')}`
        : '';
      return [integrations(), line].filter(Boolean).join('; ');
    },
  };
  // Scheduled agents (ideas from OpenJarvis): briefing, recurring tasks, proactive check-ins.
  const automation = createAutomation(services, {
    writeNote: (rel, md) => memory.vault.write(rel, md),
  });
  automation.ensureMorningBriefing();
  // Deep research agent (ideas from OpenJarvis): cited reports, saved under Research/.
  services.registry.register(
    createResearchTool(services, { writeNote: (rel, md) => memory.vault.write(rel, md) }),
  );
  // Sub-agents (idea from LibreChat): independent jobs in parallel, each in a fresh context.
  services.registry.register(createSubagentTool(services));
  registerAutomationHandlers(services, automation);
  if (!isTest) automation.start();
  // Telegram channel (ideas from OpenJarvis): only when Sir turned it on and gave a bot token.
  const telegram = createTelegramChannel(services, {
    voice: { transcribeClip: voice.transcribeClip, speak: voice.speak },
  });
  registerTelegramHandlers(services, telegram);
  if (!isTest) void telegram.start();
  app.on('will-quit', () => telegram.stop());
  // Phone remote: HTTPS web app on the home network (dictation and hands-free calls from the phone).
  const remote = createPhoneRemote(services);
  registerRemoteHandlers(services, remote);
  if (!isTest) void remote.start();
  app.on('will-quit', () => remote.stop());
  // WhatsApp (linked device): Sir messages himself "Jarvis, …" from his phone.
  const whatsapp = createWhatsAppChannel(services);
  registerWhatsAppHandlers(services, whatsapp);
  if (!isTest) void whatsapp.start();
  app.on('will-quit', () => whatsapp.stop());
  // Reply copilot (idea from jev-chat-jarvis): hotkey reads the chat in front, then opens the panel.
  const copilot = createCopilot(services, {
    // "Read chat" pressed inside Jarvis: step aside so the chat behind is the window in front.
    hideSelf: async () => {
      if (mainWindow?.isVisible() && !mainWindow.isMinimized()) mainWindow.minimize();
    },
    showSelf: showMainWindow,
  });
  registerCopilotHandlers(copilot);
  // Jarvis Apps (ADR-032/040): every app opens beside the orb. Browser, Terminal and Camera are
  // their own isolated pages, placed over Core's panel by the dock.
  const presentApp = (panel: StagePanel): void => {
    showMainWindow();
    emit('stage:panel', { panel });
  };
  const jarvisBrowser = createJarvisBrowser({
    present: () => presentApp({ kind: 'browser' }),
    onClosed: () => {
      if (dock.current() !== 'browser') return;
      dock.closed('browser');
      emit('stage:panel', { panel: null });
    },
  });
  const terminalWindow = createTerminalWindow(services.terminal, {
    present: () => presentApp({ kind: 'terminal' }),
  });
  const cameraView = createCameraView({
    picturesDir: () => app.getPath('pictures'),
    audit: (file) => services.audit.append('user', 'camera.photo', { file: basename(file) }),
  });
  const dock = createDock({
    main: () => mainWindow,
    apps: { browser: jarvisBrowser, terminal: terminalWindow, camera: cameraView },
  });
  // Nothing may cover a confirmation: docked app pages hide while one is open.
  onEmit((event, payload) => {
    if (event === 'confirm:request' || event === 'confirm:resolved')
      dock.confirmation((payload as { requestId: string }).requestId, event === 'confirm:request');
  });
  services.terminal.onEntry((entry) => terminalWindow.push(entry));
  registerAppHandlers(services, { dock });
  for (const tool of createAppTools({
    browser: jarvisBrowser,
    show: (jarvisApp) => presentApp(JARVIS_APP_INFO[jarvisApp].panel),
    settings: services.settings,
    trail: services.browserTrail,
  }))
    services.registry.register(tool);
  services.registry.register(
    copilotTool(copilot, (cap) => {
      emit('copilot:captured', cap);
      emit('nav:open', { view: 'copilot' });
      showMainWindow();
    }),
  );
  extraHotkeys.push({
    key: 'hotkeys.copilot',
    enabled: () => services.settings.get('copilot.enabled'),
    fn: () =>
      void copilot
        .capture()
        .then((cap) => {
          emit('copilot:captured', cap);
          emit('nav:open', { view: 'copilot' });
          showMainWindow();
        })
        .catch((err: unknown) =>
          emit('notify', {
            level: 'error',
            message:
              err instanceof JarvisError && err.userMessage ? err.userMessage : errorMessage(err),
          }),
        ),
  });
  app.on('will-quit', () => automation.stop());
  applyRetention(services);
  setInterval(() => applyRetention(services), 6 * 3600_000).unref();
  // Mini orb: drag along the screen edges, tuck into the edge, or hide (Design-system.md §4.3).
  miniOrb = createMiniOrb({
    load: () => services.settings.get('mini.dock'),
    save: (dock) => services.settings.set('mini.dock', dock),
    open: () => setMiniMode(false),
    hide: () => miniOrb?.window()?.hide(),
  });
  handle('app:titleBar', (req) => {
    mainWindow?.setTitleBarOverlay({ ...req, height: TITLE_BAR_HEIGHT });
    return { ok: true };
  });
  handle('app:setMiniMode', (req) => {
    setMiniMode(req.on);
    return { ok: true };
  });
  handle('mini:dragStart', () => {
    miniOrb?.dragStart();
    return { ok: true };
  });
  handle('mini:dragEnd', () => miniOrb?.dragEnd() ?? { moved: false });
  handle('mini:tuck', (req) => {
    miniOrb?.tuck(req.tucked);
    return { ok: true };
  });
  handle('mini:menu', () => {
    miniOrb?.menu();
    return { ok: true };
  });
  handle('mini:caption', (req) => {
    miniOrb?.caption(req.open);
    return { ok: true };
  });
  // Tasks and Calendar (PRD F25/F26): views, Jarvis's tools and reminders share one planner.
  registerPlannerHandlers(services.planner);
  services.navListeners.add(() => setMiniMode(false));
  if (!isTest) services.planner.start();
  app.on('will-quit', () => services.planner.stop());
  let voiceStarted: Promise<{ ok: boolean }> | null = null;
  if (services.settings.get('onboarding.complete')) {
    void mcp.manager.start();
    startMemory();
    voiceStarted = voice
      .start()
      .then((r) => {
        if (!r.ok && r.error)
          emit('notify', { level: 'warn', message: r.error, action: 'settings:voice' });
        return r;
      })
      .catch((err: unknown) => {
        logger.warn({ err: errorMessage(err) }, 'voice start failed');
        return { ok: false };
      });
  }
  services.settings.onChange((key) => {
    if (key === 'vault.path' && services.settings.get('onboarding.complete')) startMemory();
    if (key === 'app.startWithWindows')
      applyLoginItem(services.settings.get('app.startWithWindows'));
  });

  const hidden =
    !isTest && (process.argv.includes('--hidden') || services.settings.get('app.startHidden'));
  mainWindow = createMainWindow({ startHidden: hidden });
  addEventTarget(mainWindow);
  // Spoken hello with today's plan, then the mic opens. The renderer plays the audio, so it waits
  // for the page; quiet mode (do not disturb) skips it.
  const greetAfterStart = voiceStarted;
  if (!isTest && greetAfterStart && services.settings.get('voice.startupGreeting'))
    mainWindow.webContents.once(
      'did-finish-load',
      () =>
        void greetAfterStart.then((r) => {
          if (!r.ok || services.settings.get('quiet.until') > Date.now()) return;
          setTimeout(
            () => voice.voice.welcome(startupLine(startupFacts(services.planner))),
            STARTUP_GREETING_DELAY_MS,
          );
        }),
    );
  // §6.1: the orb follows music on the PC (off in tests; stops with the main window so the app can quit).
  const meter = createMusicMeter((rms) => emit('music:level', { rms }));
  const applyMeter = (): void => {
    if (!isTest && services.settings.get('appearance.orbMusic')) meter.start();
    else meter.stop();
  };
  applyMeter();
  mainWindow.on('closed', () => meter.stop());
  services.settings.onChange((key) => {
    if (key === 'appearance.orbMusic') applyMeter();
  });
  wireWindowBehaviour(services);
  wireHotkeysAndTray(services);
  services.scheduler.start();
  logger.info({ version: app.getVersion(), isTest }, 'jarvis started');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  void app.whenReady().then(boot);
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => {
    unregisterHotkeys();
    tray?.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
