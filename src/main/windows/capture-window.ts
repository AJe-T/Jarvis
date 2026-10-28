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

/** What capture.html reports once the microphone is open (Phase 0 diagnostics). */
const MicInfo = z.object({
  requestedLabel: z.string().max(300),
  /**
   * id = the saved Chromium deviceId opened; matched = the Windows name was found; fallback = neither
   * was found, so the default mic opened (shown in Settings → Voice); default = none was chosen.
   */
  match: z.enum(['default', 'id', 'matched', 'fallback']),
  label: z.string().max(300),
  deviceId: z.string().max(300),
  requestedRate: z.number(),
  actualRate: z.number(),
  trackRate: z.number().nullable(),
  channels: z.number().nullable(),
  echoCancellation: z.boolean().nullable(),
  noiseSuppression: z.boolean().nullable(),
  autoGainControl: z.boolean().nullable(),
  /** The microphones Chromium can open, so Sir can pick one directly when the name didn't match. */
  inputs: z.array(z.object({ deviceId: z.string().max(300), label: z.string().max(300) })).max(16),
});
export type CaptureMicInfo = z.infer<typeof MicInfo>;

/** One echo-cancelled recorder's reports: a frame was thrown away (and why); the mic opened. */
export interface MicHooks {
  onDrop?(reason: 'queue' | 'length'): void;
  onStarted?(info: CaptureMicInfo): void;
}

/** Which microphone to open: its Chromium deviceId when known, else its Windows name ('' = default). */
export interface CaptureDevice {
  label: string;
  id: string;
}

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
  /** A Recorder fed by the echo-cancelled microphone. */
  recorder(device: CaptureDevice, frameLength: number, hooks?: MicHooks): Recorder;
  /** One JPEG still from the camera ('' = default camera). */
  snapshot(deviceLabel?: string): Promise<{ jpegBase64: string }>;
  /** The echo-cancelled microphone failed on this PC; the voice system falls back to the native one. */
  broken(): boolean;
  /** Called once the echo-cancelled microphone fails, so the voice system can switch to the native one. */
  onBroken(listener: (why: string) => void): void;
  /** Try the echo-cancelled microphone again (the voice system's retry after a failure). */
  reset(): void;
  destroy(): void;
}

export function createCaptureWindow(logger: Logger): CaptureWindow {
  const log = logger.child({ module: 'windows.capture' });
  let win: BrowserWindow | null = null;
  let loaded: Promise<void> | null = null;
  let active: ReturnType<typeof createStreamRecorder> | null = null;
  let activeHooks: MicHooks = {};
  let isBroken = false;
  const brokenListeners = new Set<(why: string) => void>();
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
    else activeHooks.onDrop?.('length');
  });
  ipcMain.on('capture:mic', (e, state: unknown, detail: unknown) => {
    if (!fromCapture(e)) return;
    if (state === 'started') return logStarted(detail);
    if (state !== 'failed') return;
    const why = String(detail).slice(0, 300);
    log.warn({ why }, 'echo-cancelled microphone failed; using the native one');
    isBroken = true;
    active?.fail(new Error(`microphone: ${why}`));
    for (const l of brokenListeners) l(why);
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

  function logStarted(detail: unknown): void {
    let info: z.infer<typeof MicInfo> | null = null;
    try {
      const parsed = MicInfo.safeParse(JSON.parse(String(detail).slice(0, 20_000)));
      if (parsed.success) info = parsed.data;
    } catch {
      // an older capture page sends no details
    }
    if (!info) return log.info('echo-cancelled microphone started');
    const { inputs, ...rest } = info;
    if (info.match === 'fallback')
      log.warn(
        { ...rest, inputs: inputs.length },
        'echo-cancelled microphone: the chosen device was not found, using the default',
      );
    else log.info({ ...rest, inputs: inputs.length }, 'echo-cancelled microphone started');
    activeHooks.onStarted?.(info);
  }

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
        for (const l of brokenListeners) l('the capture window failed to load');
      });
  }

  return {
    recorder(device, frameLength, hooks = {}) {
      const rec = createStreamRecorder({
        frameLength,
        onDrop: () => hooks.onDrop?.('queue'),
        onStart: () => {
          active = rec;
          activeHooks = hooks;
          command({
            type: 'mic-start',
            deviceLabel: device.label,
            deviceId: device.id,
            frameLength,
          });
        },
        onStop: () => {
          if (active !== rec) return;
          active = null;
          activeHooks = {};
          // No window, no open mic. Opening one just to stop it (at quit) failed and was logged as
          // "capture window failed to load" in every session.
          if (win && !win.isDestroyed()) command({ type: 'mic-stop' });
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
    reset() {
      isBroken = false;
    },
    onBroken(l) {
      brokenListeners.add(l);
    },

    destroy() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
