import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Notification,
  app,
  clipboard,
  safeStorage,
  shell,
  type BrowserWindow,
  type Tray,
} from 'electron';
import { addEventTarget, emit } from './ipc/emit';
import { registerCoreHandlers } from './ipc/handlers/core';
import { registerMemoryHandlers, writeQuickFacts } from './ipc/handlers/memory';
import { registerSafetyHandlers } from './ipc/handlers/safety';
import { createMemorySystem } from './memory/memory-system';
import { registerVoiceHandlers } from './ipc/handlers/voice';
import { createVoiceSystem } from './voice/voice-system';
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

/** Push-to-talk listeners (the voice controller registers one in Phase 4). */
export const pttHandlers = new Set<() => void>();

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
    );
    if (failed.length)
      emit('notify', {
        level: 'warn',
        message: `These shortcuts are used by another app: ${failed.join(', ')}. Change them in Settings → Hotkeys.`,
      });
  };
  bind();
  s.settings.onChange((key) => {
    if (key.startsWith('hotkeys.')) bind();
  });
  if (isTest) return;
  tray = createTray({
    show: showMainWindow,
    stopEverything: () => s.killSwitch.trigger('tray'),
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
  pttHandlers.add(() => voice.voice.ptt());
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
    },
  });
  registerSafetyHandlers(services);
  registerMemoryHandlers(services, memory);
  registerVoiceHandlers(services, voice.voice, {
    setActiveConversation: voice.setActiveConversation,
    isTest,
  });
  if (services.settings.get('onboarding.complete')) {
    startMemory();
    void voice.start().then((r) => {
      if (!r.ok && r.error)
        emit('notify', { level: 'warn', message: r.error, action: 'settings:voice' });
    });
  }
  services.settings.onChange((key) => {
    if (key === 'vault.path' && services.settings.get('onboarding.complete')) startMemory();
  });

  mainWindow = createMainWindow();
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
