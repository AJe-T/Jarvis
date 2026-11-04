import { join } from 'node:path';
import { BrowserWindow, app, desktopCapturer, ipcMain, session, type Session } from 'electron';
import { z } from 'zod';
import { logger } from '../logging/logger';
import type { MeetingDeps } from '../meetings/meetings';
import { CSP, HARDENED_WEB_PREFERENCES, hardenWindow, isAppPage } from './hardening';

/**
 * Security.md §7: the meeting recorder (idea from anomalyco/hex) runs in a hidden window with its
 * OWN in-memory session, like the music meter: only meeting.html may open the microphone and the
 * PC's loopback sound, and only while a meeting is being recorded. It sends 16 kHz mono frames to
 * main, tagged "you" (microphone) or "them" (the PC's sound); nothing is written to disk.
 */
const PARTITION = 'meeting-recorder';
const Who = z.enum(['you', 'them']);
/** 100 ms frames; anything bigger is refused. */
const MAX_FRAME_BYTES = 16_000;

export function isMeetingUrl(raw: string): boolean {
  return isAppPage(raw, 'meeting.html');
}

let hardened: Session | null = null;

function meetingSession(): Session {
  if (hardened) return hardened;
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  const allowed = (permission: string, url: string): boolean =>
    (permission === 'media' || permission === 'display-capture') && isMeetingUrl(url);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed(permission, details.requestingUrl ?? wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission) => allowed(permission, wc?.getURL() ?? ''));
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.audioRequested || !isMeetingUrl(request.frame?.url ?? '')) return callback({});
    // Windows hands out loopback audio only together with a screen; the page stops that track.
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([screen]) => callback(screen ? { video: screen, audio: 'loopback' } : {}))
      .catch((err: unknown) => {
        logger.warn({ err }, 'meeting recorder: no screen source');
        callback({});
      });
  });
  hardened = ses;
  return ses;
}

type Handlers = Parameters<MeetingDeps['openWindow']>[0];

/** Opens the recorder; IPC listeners are added once and only accept the window that is open. */
export function createMeetingWindowOpener(): MeetingDeps['openWindow'] {
  let win: BrowserWindow | null = null;
  let handlers: Handlers | null = null;
  const fromRecorder = (e: Electron.IpcMainEvent): boolean =>
    !!win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.on('meeting:frame', (e, who: unknown, bytes: unknown) => {
    if (!fromRecorder(e) || !handlers) return;
    const w = Who.safeParse(who);
    if (!w.success || !(bytes instanceof Uint8Array)) return;
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FRAME_BYTES || bytes.byteLength % 2)
      return;
    // Copy into an aligned buffer: the IPC view may start at an odd offset.
    const pcm = new Int16Array(bytes.byteLength / 2);
    new Uint8Array(pcm.buffer).set(bytes);
    handlers.onFrame(w.data, pcm);
  });
  ipcMain.on('meeting:track', (e, who: unknown, state: unknown, detail: unknown) => {
    if (!fromRecorder(e) || !handlers) return;
    const w = Who.safeParse(who);
    const s = z.enum(['started', 'failed']).safeParse(state);
    if (w.success && s.success) handlers.onTrack(w.data, s.data, String(detail).slice(0, 300));
  });

  return (h) => {
    if (win && !win.isDestroyed()) win.destroy();
    handlers = h;
    win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        ...HARDENED_WEB_PREFERENCES,
        session: meetingSession(),
        // Hidden windows are throttled by default, which would stall the audio.
        backgroundThrottling: false,
        preload: join(__dirname, '../preload/meeting.js'),
      },
    });
    hardenWindow(win);
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/meeting.html`);
    else void win.loadFile(join(__dirname, '../renderer/meeting.html'));
    const mine = win;
    return {
      close() {
        if (!mine.isDestroyed()) mine.destroy();
        if (win === mine) {
          win = null;
          handlers = null;
        }
      },
    };
  };
}
