import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { addEventTarget, emit } from './ipc/emit';
import { registerCoreHandlers } from './ipc/handlers/core';
import { registerMemoryHandlers, writeQuickFacts } from './ipc/handlers/memory';
import { registerSafetyHandlers } from './ipc/handlers/safety';
import { createMemorySystem } from './memory/memory-system';
import { createResearchTool } from './agent/research';
import { createAutomation } from './automation/automation';
import { registerAutomationHandlers } from './ipc/handlers/automation';
import { registerSkillHandlers } from './ipc/handlers/skills';
import { registerVoiceHandlers } from './ipc/handlers/voice';
import { createVoiceSystem } from './voice/voice-system';
import { registerMcpHandlers } from './ipc/handlers/mcp';
import { createMcpSystem } from './mcp/mcp-system';
import { createComputerSystem } from './tools/computer/computer-system';
import { createElectronScreen } from './tools/computer/electron-screen';
import { createFakeDriver, createFakeScreen, createNutDriver } from './tools/computer/drivers';
import { createComputerOverlay } from './windows/overlay-window';
import { createMiniWindow } from './windows/mini-window';
import { applyRetention, registerDataHandlers } from './ipc/handlers/data';
import { handle } from './ipc/handle';
import { errorMessage } from './errors';
import { initFileLogging, logger } from './logging/logger';
import { createServices, type Services } from './services';
import { createFakeOs, createWindowsOs } from './tools/native/os';
import { hardenSession } from './windows/hardening';
import { registerHotkeys, unregisterHotkeys } from './windows/hotkeys';
import { createMainWindow } from './windows/main-window';
import { createTray, iconPath } from './windows/tray';

const isTest = process.env['JARVIS_TEST'] === '1';
if (process.env['JARVIS_USER_DATA']) app.setPath('userData', process.env['JARVIS_USER_DATA']);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

let miniWindow: BrowserWindow | null = null;

/** Design-system.md §4.3 mini orb: hides the main window and shows a small always-on-top orb (or back). */
function setMiniMode(on: boolean): void {
  if (on) {
    if (!miniWindow || miniWindow.isDestroyed()) {
      miniWindow = createMiniWindow();
      addEventTarget(miniWindow);
      miniWindow.once('ready-to-show', () => miniWindow?.showInactive());
    } else miniWindow.showInactive();
    mainWindow?.hide();
  } else {
    miniWindow?.hide();
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
  const voice = createVoiceSystem(services);
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
  registerMemoryHandlers(services, memory);
  registerVoiceHandlers(
    services,
    voice.voice,
    {
      setActiveConversation: voice.setActiveConversation,
      isTest,
    },
    voice.local,
    voice.dictations,
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
  // Scheduled agents (ideas from OpenJarvis): briefing, recurring tasks, proactive check-ins.
  const automation = createAutomation(services, {
    writeNote: (rel, md) => memory.vault.write(rel, md),
  });
  automation.ensureMorningBriefing();
  // Deep research agent (ideas from OpenJarvis): cited reports, saved under Research/.
  services.registry.register(
    createResearchTool(services, { writeNote: (rel, md) => memory.vault.write(rel, md) }),
  );
  registerAutomationHandlers(services, automation);
  if (!isTest) automation.start();
  app.on('will-quit', () => automation.stop());
  applyRetention(services);
  setInterval(() => applyRetention(services), 6 * 3600_000).unref();
  handle('app:setMiniMode', (req) => {
    setMiniMode(req.on);
    return { ok: true };
  });
  if (services.settings.get('onboarding.complete')) {
    void mcp.manager.start();
    startMemory();
    void voice.start().then((r) => {
      if (!r.ok && r.error)
        emit('notify', { level: 'warn', message: r.error, action: 'settings:voice' });
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
