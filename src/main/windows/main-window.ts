import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { HARDENED_WEB_PREFERENCES, hardenWindow } from './hardening';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#060A12',
    title: 'Jarvis',
    autoHideMenuBar: true,
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  hardenWindow(win);
  win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
