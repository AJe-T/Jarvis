import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, session, shell, type BrowserWindow, type WebContents } from 'electron';

/** Security.md §7. Returns true when the URL belongs to our own app bundle / dev server. */
export function isAppUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) return url.origin === new URL(devUrl).origin;
    return url.protocol === 'file:';
  } catch {
    return false;
  }
}

/**
 * True only for this app's own bundled page `name` (renderer/<name>), never for another file that
 * happens to share its name (a saved artifact called "artifact.html" must not get its privileges).
 */
export function isAppPage(rawUrl: string, name: string): boolean {
  try {
    const url = new URL(rawUrl);
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl)
      return url.origin === new URL(devUrl).origin && url.pathname === `/${name}`;
    const own = pathToFileURL(join(__dirname, '../renderer', name));
    const path = (u: URL): string => decodeURIComponent(u.pathname).toLowerCase();
    return url.protocol === 'file:' && url.host === '' && path(url) === path(own);
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export const HARDENED_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  webviewTag: false,
  spellcheck: false,
} as const;

export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // Frames inside our pages (chat artifacts) may only ever show the sandboxed artifact page.
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isArtifactUrl(event.url)) event.preventDefault();
  });
}

/** The sandboxed page chat artifacts are shown in (renderer/artifact.html). */
export function isArtifactUrl(rawUrl: string): boolean {
  return isAppPage(rawUrl, 'artifact.html');
}

/** artifact.html's own policy (the same as its <meta>): inline code runs, nothing loads or leaves. */
export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; " +
  "font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; " +
  "form-action 'none'; base-uri 'none'";

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'";

/** Mic is captured in main (ADR-007), so the renderer never needs permissions. */
export function hardenSession(): void {
  // The <meta> CSP covers file:// loads; this header also covers the dev server (frame-ancestors needs a header).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const policy = isArtifactUrl(details.url) ? ARTIFACT_CSP : CSP;
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

export function hardenWindow(win: BrowserWindow): void {
  hardenWebContents(win.webContents);
}
