import { join } from 'node:path';
import { BrowserWindow, app, nativeTheme, screen } from 'electron';
import { HARDENED_WEB_PREFERENCES, hardenWindow } from './hardening';

export function createMainWindow(opts: { startHidden?: boolean } = {}): BrowserWindow {
  // Wide enough for the labelled sidebar, the Core orb and its conversation log, never past the screen.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1400, Math.round(area.width * 0.9)),
    height: Math.min(880, Math.round(area.height * 0.9)),
    minWidth: 480,
    minHeight: 520,
    show: false,
    // = --bg-main for the Windows theme, so there is no flash before first paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#070A10' : '#F2F5F8',
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
