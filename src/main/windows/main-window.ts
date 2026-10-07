import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { HARDENED_WEB_PREFERENCES, hardenWindow } from './hardening';

export function createMainWindow(opts: { startHidden?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 520,
    show: false,
    backgroundColor: '#05060B', // = --bg-950; no white flash before first paint
    title: 'Jarvis',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  hardenWindow(win);
  // PRD F6.4: start hidden in the tray when launched at login (or when Sir chose it).
  if (!opts.startHidden) win.once('ready-to-show', () => win.show());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
