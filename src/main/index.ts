import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { hardenSession } from './windows/hardening';
import { createMainWindow } from './windows/main-window';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    hardenSession();
    mainWindow = createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
