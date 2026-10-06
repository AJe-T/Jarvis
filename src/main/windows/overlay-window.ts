import { join } from 'node:path';
import { BrowserWindow, app, screen } from 'electron';
import { HARDENED_WEB_PREFERENCES, hardenWindow } from './hardening';

function load(win: BrowserWindow, route: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}#${route}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route });
}

function overlayWindow(
  opts: Electron.BrowserWindowConstructorOptions,
  route: string,
): BrowserWindow {
  const win = new BrowserWindow({
    ...opts,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: route === 'overlay-pill',
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  hardenWindow(win);
  win.setAlwaysOnTop(true, 'screen-saver');
  // Design-system.md §4.4: never visible in the screenshots Claude sees.
  win.setContentProtection(true);
  load(win, route);
  return win;
}

/** The red "Computer Control" frame: a click-through border plus a small Stop pill (the only clickable part). */
export function createComputerOverlay() {
  let border: BrowserWindow | null = null;
  let pill: BrowserWindow | null = null;

  function ensure(): void {
    const { bounds } = screen.getPrimaryDisplay();
    if (!border || border.isDestroyed()) {
      border = overlayWindow(
        { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        'overlay-border',
      );
      border.setIgnoreMouseEvents(true);
    }
    if (!pill || pill.isDestroyed()) {
      const width = 460;
      pill = overlayWindow(
        {
          x: bounds.x + Math.round((bounds.width - width) / 2),
          y: bounds.y + 12,
          width,
          height: 48,
        },
        'overlay-pill',
      );
    }
  }

  return {
    show(): void {
      ensure();
      border?.showInactive();
      pill?.showInactive();
    },
    hide(): void {
      border?.hide();
      pill?.hide();
    },
    isOverlay: (w: BrowserWindow): boolean => w === border || w === pill,
    /** The full-screen border is click-through, so it never counts as a Jarvis click target. */
    isBorder: (w: BrowserWindow): boolean => w === border,
    pill: (): BrowserWindow | null => pill,
    destroy(): void {
      border?.destroy();
      pill?.destroy();
    },
  };
}

export type ComputerOverlay = ReturnType<typeof createComputerOverlay>;
