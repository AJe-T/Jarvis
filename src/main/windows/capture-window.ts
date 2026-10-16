import { join } from 'node:path';
import { BrowserWindow, app, ipcMain, session, type Session } from 'electron';
import { z } from 'zod';
import { newId } from '../lib/util';
import type { Logger } from '../logging/logger';
import { createStreamRecorder } from '../voice/stream-recorder';
import type { Recorder } from '../voice/types';
import { CSP, HARDENED_WEB_PREFERENCES, hardenWindow, isAppPage } from './hardening';

/**
 * Security.md §7 exception (like the music meter): a hidden window, with its OWN in-memory session,
 * is the only page that may open the microphone and camera, and only capture.html in it. The app
 * session keeps denying every permission. Two uses:
 * - an echo-cancelled microphone (Chromium's canceller removes Jarvis's own voice, so Sir can
 *   interrupt without headphones; idea from Open-LLM-VTuber), as a Recorder for the voice controller;
 * - one camera still at a time for look_through_camera (after Sir confirms it).
 */

const PARTITION = 'jarvis-capture';
const SNAP_TIMEOUT_MS = 20_000;
const Frame = z
  .instanceof(Uint8Array)
  .refine((b) => b.length > 0 && b.length <= 32_768 && b.length % 2 === 0);

export function isCaptureUrl(raw: string): boolean {
  return isAppPage(raw, 'capture.html');
}

let hardened: Session | null = null;
function captureSession(): Session {
  if (hardened) return hardened;
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  // Only microphone/camera, only for capture.html.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(permission === 'media' && isCaptureUrl(details.requestingUrl ?? wc.getURL()));
  });
  ses.setPermissionCheckHandler(
    (wc, permission) => permission === 'media' && isCaptureUrl(wc?.getURL() ?? ''),
  );
  hardened = ses;
  return ses;
}

export interface CaptureWindow {
  /** A Recorder fed by the echo-cancelled microphone (device by Windows name; '' = default). */
  recorder(deviceLabel: string, frameLength: number): Recorder;
  /** One JPEG still from the camera ('' = default camera). */
  snapshot(deviceLabel?: string): Promise<{ jpegBase64: string }>;
  /** The echo-cancelled microphone failed on this PC; the voice system falls back to the native one. */
  broken(): boolean;
  /** Called once the echo-cancelled microphone fails, so the voice system can switch to the native one. */
  onBroken(listener: () => void): void;
  destroy(): void;
}

export function createCaptureWindow(logger: Logger): CaptureWindow {
  const log = logger.child({ module: 'windows.capture' });
  let win: BrowserWindow | null = null;
  let loaded: Promise<void> | null = null;
  let active: ReturnType<typeof createStreamRecorder> | null = null;
  let isBroken = false;
  const brokenListeners = new Set<() => void>();
  const snaps = new Map<
    string,
    { resolve(v: { jpegBase64: string }): void; reject(e: Error): void }
  >();

  const fromCapture = (e: Electron.IpcMainEvent): boolean =>
    !!win &&
    !win.isDestroyed() &&
    e.sender === win.webContents &&
    isCaptureUrl(e.senderFrame?.url ?? '');

  ipcMain.on('capture:frames', (e, raw: unknown) => {
    if (!fromCapture(e)) return;
    const bytes = Frame.safeParse(raw);
    if (!bytes.success || !active) return;
    // Copied so the samples are aligned whatever buffer IPC handed us. Frames still in flight from a
    // previous microphone may have another length (wake engines need exact frames): drop those.
    const frame = new Int16Array(new Uint8Array(bytes.data).buffer);
    if (frame.length === active.frameLength) active.push(frame);
  });
  ipcMain.on('capture:mic', (e, state: unknown, detail: unknown) => {
    if (!fromCapture(e) || state !== 'failed') return;
    const why = String(detail).slice(0, 300);
    log.warn({ why }, 'echo-cancelled microphone failed; using the native one');
    isBroken = true;
    active?.fail(new Error(`microphone: ${why}`));
    for (const l of brokenListeners) l();
  });
  ipcMain.on('capture:snapped', (e, id: unknown, data: unknown, error: unknown) => {
    if (!fromCapture(e) || typeof id !== 'string') return;
    const p = snaps.get(id);
    if (!p) return;
    snaps.delete(id);
    const jpeg = typeof data === 'string' && data.length >= 100 && data.length <= 12_000_000;
    // "/9j/" is a JPEG's first bytes (FF D8 FF) in base64.
    if (jpeg && data.startsWith('/9j/') && /^[A-Za-z0-9+/=]+$/.test(data))
      p.resolve({ jpegBase64: data });
    else {
      const why = typeof error === 'string' && error ? error : 'The camera did not answer.';
      p.reject(new Error(why.slice(0, 300)));
    }
  });

  function ensure(): Promise<void> {
    if (win && !win.isDestroyed() && loaded) return loaded;
    const w = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        ...HARDENED_WEB_PREFERENCES,
        session: captureSession(),
        // Hidden windows are throttled by default, which would starve the microphone.
        backgroundThrottling: false,
        preload: join(__dirname, '../preload/capture.js'),
      },
    });
    hardenWindow(w);
    w.on('closed', () => {
      win = null;
      loaded = null;
    });
    win = w;
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    loaded = (
      !app.isPackaged && devUrl
        ? w.loadURL(`${devUrl}/capture.html`)
        : w.loadFile(join(__dirname, '../renderer/capture.html'))
    ).then(() => undefined);
    return loaded;
  }

  function command(cmd: Record<string, unknown>): void {
    void ensure()
      .then(() => win?.webContents.send('capture:command', cmd))
      .catch((err: unknown) => {
        log.warn({ err: String(err) }, 'capture window failed to load');
        isBroken = true;
        active?.fail(new Error('the capture window failed to load'));
        for (const l of brokenListeners) l();
      });
  }

  return {
    recorder(deviceLabel, frameLength) {
      const rec = createStreamRecorder({
        frameLength,
        onStart: () => {
          active = rec;
          command({ type: 'mic-start', deviceLabel, frameLength });
        },
        onStop: () => {
          if (active !== rec) return;
          active = null;
          command({ type: 'mic-stop' });
        },
      });
      return rec;
    },

    snapshot(deviceLabel = '') {
      const id = newId('snap_');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          snaps.delete(id);
          reject(new Error('The camera took too long to answer.'));
        }, SNAP_TIMEOUT_MS);
        snaps.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        command({ type: 'snap', id, deviceLabel });
      });
    },

    broken: () => isBroken,
    onBroken(l) {
      brokenListeners.add(l);
    },

    destroy() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
