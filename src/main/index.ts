import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage, type BrowserWindow } from 'electron';
import { addEventTarget, emit } from './ipc/emit';
import { registerCoreHandlers } from './ipc/handlers/core';
import { initFileLogging, logger } from './logging/logger';
import { createServices } from './services';
import { hardenSession } from './windows/hardening';
import { createMainWindow } from './windows/main-window';

const isTest = process.env['JARVIS_TEST'] === '1';
if (process.env['JARVIS_USER_DATA']) app.setPath('userData', process.env['JARVIS_USER_DATA']);

/** Dev convenience only: ANTHROPIC_API_KEY from the repo's .env (never in packaged builds). */
function devSecrets(): Record<string, string> {
  if (app.isPackaged || isTest) return {};
  const file = join(app.getAppPath(), '.env');
  if (!existsSync(file)) return {};
  const m = /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync(file, 'utf8'));
  return m?.[1]?.trim() ? { anthropic: m[1].trim() } : {};
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData');
  await initFileLogging(join(userData, 'logs'));
  hardenSession();

  const names = ['documents', 'desktop', 'downloads', 'pictures', 'videos', 'music'] as const;
  // Test runs get a sandboxed fake home so they never touch Sir's real folders.
  const paths = Object.fromEntries(
    names.map((n) => {
      if (!isTest) return [n, app.getPath(n)];
      const dir = join(userData, 'home', n);
      mkdirSync(dir, { recursive: true });
      return [n, dir];
    }),
  ) as Record<(typeof names)[number], string>;
  const services = createServices({
    userData,
    isTest,
    encryptor: safeStorage,
    emit,
    devSecrets: devSecrets(),
    paths,
  });
  if (!services.dbHealthy) logger.error('database failed quick_check');
  registerCoreHandlers(services);

  mainWindow = createMainWindow();
  addEventTarget(mainWindow);
  logger.info({ version: app.getVersion(), isTest }, 'jarvis started');
}

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  void app.whenReady().then(boot);
  app.on('window-all-closed', () => app.quit());
}
