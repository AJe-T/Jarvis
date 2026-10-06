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
}

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'";

/** Mic is captured in main (ADR-007), so the renderer never needs permissions. */
export function hardenSession(): void {
  // The <meta> CSP covers file:// loads; this header also covers the dev server (frame-ancestors needs a header).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

export function hardenWindow(win: BrowserWindow): void {
  hardenWebContents(win.webContents);
}
