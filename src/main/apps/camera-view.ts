import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  WebContentsView,
  app,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type Session,
} from 'electron';
import { HARDENED_WEB_PREFERENCES, hardenWebContents, isAppPage } from '../windows/hardening';

/**
 * ADR-040 Jarvis Camera, beside the orb: a local page (renderer/camera.html) in its own session that
 * alone may open the camera (video only, never the microphone). Its preload can only save a photo
 * and show the last one in its folder. Closing the panel destroys the view, which turns the camera
 * off. Photos never go to Jarvis or Claude from here (look_through_camera is separate and confirmed).
 */

const PARTITION = 'jarvis-camera';
/** A webcam JPEG is well under this. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export const isCameraUrl = (raw: string): boolean => isAppPage(raw, 'camera.html');

/** base64 that decodes to a JPEG (FF D8 FF) of a sane size, or null. */
export function photoBytes(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || raw.length > (MAX_PHOTO_BYTES * 4) / 3 + 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const buf = Buffer.from(raw, 'base64');
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? buf : null;
}

/** "Photo 2026-10-15 17-40-14.jpg" */
export function photoName(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `Photo ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}.jpg`;
}

let hardened: Session | null = null;
function cameraSession(): Session {
  if (hardened) return hardened;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    callback(
      permission === 'media' &&
        !types.includes('audio') &&
        isCameraUrl(details.requestingUrl ?? wc.getURL()),
    );
  });
  ses.setPermissionCheckHandler(
    (wc, permission) => permission === 'media' && isCameraUrl(wc?.getURL() ?? ''),
  );
  hardened = ses;
  return ses;
}

export function createCameraView(deps: { picturesDir(): string; audit?(path: string): void }) {
  let view: WebContentsView | null = null;
  let lastSaved: string | null = null;
  const live = (): WebContentsView | null =>
    view && !view.webContents.isDestroyed() ? view : null;
  const fromCamera = (e: IpcMainInvokeEvent): boolean =>
    !!live() && e.sender === view?.webContents && isCameraUrl(e.senderFrame?.url ?? '');

  ipcMain.handle('camera:save', async (e, raw: unknown) => {
    if (!fromCamera(e)) throw new Error('not the camera page');
    const bytes = photoBytes(raw);
    if (!bytes) throw new Error('That is not a photo.');
    const dir = join(deps.picturesDir(), 'Jarvis Camera');
    await mkdir(dir, { recursive: true });
    const name = photoName(new Date());
    const file = join(dir, name);
    await writeFile(file, bytes, { flag: 'wx' });
    lastSaved = file;
    deps.audit?.(file);
    return { name, path: file };
  });
  ipcMain.handle('camera:reveal', (e) => {
    if (!fromCamera(e)) throw new Error('not the camera page');
    if (lastSaved) shell.showItemInFolder(lastSaved);
  });

  function ensure(): WebContentsView {
    const existing = live();
    if (existing) return existing;
    const v = new WebContentsView({
      webPreferences: {
        ...HARDENED_WEB_PREFERENCES,
        session: cameraSession(),
        preload: join(__dirname, '../preload/camera.js'),
      },
    });
    v.setBackgroundColor('#0b0f14');
    hardenWebContents(v.webContents);
    v.webContents.on('will-navigate', (event) => event.preventDefault());
    view = v;
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) void v.webContents.loadURL(`${devUrl}/camera.html`);
    else void v.webContents.loadFile(join(__dirname, '../renderer/camera.html'));
    return v;
  }

  return {
    views(): Array<{ view: WebContentsView; height: number | null }> {
      return [{ view: ensure(), height: null }];
    },
    /** Off the screen means off: the page (and with it the camera) is closed. */
    released(): void {
      live()?.webContents.close();
      view = null;
    },
  };
}

export type CameraView = ReturnType<typeof createCameraView>;
