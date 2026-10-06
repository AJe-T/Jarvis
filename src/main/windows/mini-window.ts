import { join } from 'node:path';
import { BrowserWindow, app, screen } from 'electron';
import { HARDENED_WEB_PREFERENCES, hardenWindow } from './hardening';

/** Design-system.md §4.3: frameless, always-on-top orb (with a caption bubble while Jarvis talks). */
export function createMiniWindow(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 320;
  const height = 120;
  const win = new BrowserWindow({
    x: area.x + area.width - width - 24,
    y: area.y + area.height - height - 24,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    title: 'Jarvis (mini)',
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  hardenWindow(win);
  win.setAlwaysOnTop(true, 'floating');
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}#mini`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' });
  return win;
}
