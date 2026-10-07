import { join } from 'node:path';
import { BrowserWindow, app, desktopCapturer, ipcMain, session, type Session } from 'electron';
import { z } from 'zod';
import { logger } from '../logging/logger';
import { CSP, HARDENED_WEB_PREFERENCES, hardenWindow, isAppUrl } from './hardening';

/**
 * Security.md §7, Design-system.md §6.1: the orb follows music playing on the PC. Loopback audio
 * is only reachable through getDisplayMedia, so it runs in a hidden window with its OWN in-memory
 * session: that session alone may capture, only for meter.html, only loopback audio. The app
 * session keeps denying every permission. The meter sends back one number; nothing is recorded.
 */
const PARTITION = 'music-meter';
const Level = z.number().min(0).max(1);

export function isMeterUrl(raw: string): boolean {
  if (!isAppUrl(raw)) return false;
  return new URL(raw).pathname.endsWith('/meter.html');
}

let hardened: Session | null = null;

function meterSession(): Session {
  if (hardened) return hardened;
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  // Only the screen-capture permission getDisplayMedia needs, only for meter.html.
  const capture = (permission: string, url: string): boolean =>
    (permission === 'display-capture' || permission === 'media') && isMeterUrl(url);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(capture(permission, details.requestingUrl ?? wc.getURL()));
  });
  // file:// origins are opaque ("file:///"), so checks go by the page actually asking.
  ses.setPermissionCheckHandler((wc, permission) => capture(permission, wc?.getURL() ?? ''));
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.audioRequested || !isMeterUrl(request.frame?.url ?? '')) return callback({});
    // Windows only hands out loopback audio together with a screen; the meter stops that track.
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([screen]) => callback(screen ? { video: screen, audio: 'loopback' } : {}))
      .catch((err: unknown) => {
        logger.warn({ err }, 'music meter: no screen source');
        callback({});
      });
  });
  hardened = ses;
  return ses;
}

export interface MusicMeter {
  start(): void;
  stop(): void;
}

export function createMusicMeter(onLevel: (rms: number) => void): MusicMeter {
  let win: BrowserWindow | null = null;
  const fromMeter = (e: Electron.IpcMainEvent): boolean =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.on('meter:level', (e, raw: unknown) => {
    if (!fromMeter(e)) return;
    const parsed = Level.safeParse(raw);
    if (parsed.success) onLevel(parsed.data);
  });
  ipcMain.on('meter:failed', (e, reason: unknown) => {
    if (fromMeter(e)) logger.warn({ reason: String(reason).slice(0, 200) }, 'music meter off');
  });

  return {
    start() {
      if (win && !win.isDestroyed()) return;
      win = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
          ...HARDENED_WEB_PREFERENCES,
          session: meterSession(),
          // Hidden windows are throttled by default, which would freeze the meter.
          backgroundThrottling: false,
          preload: join(__dirname, '../preload/meter.js'),
        },
      });
      hardenWindow(win);
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/meter.html`);
      else void win.loadFile(join(__dirname, '../renderer/meter.html'));
    },
    stop() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
      onLevel(0);
    },
  };
}
