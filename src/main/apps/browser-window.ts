import { join } from 'node:path';
import { WebContentsView, app, ipcMain, session, type IpcMainEvent, type Session } from 'electron';
import { z } from 'zod';
import { urlGuard } from '../security/guards';
import { HOME, addressFor } from './address';
import { HARDENED_WEB_PREFERENCES, hardenWebContents } from '../windows/hardening';
import {
  SNAPSHOT_JS,
  focusJs,
  pointJs,
  scrollJs,
  selectJs,
  isRiskyClick,
  type RefInfo,
  type Snapshot,
} from './browser-dom';

/**
 * ADR-032/040 Jarvis Browser, Security.md §7 exception (like the music meter): web pages Sir or
 * Jarvis opens, shown beside the orb (apps/dock.ts places its two views over Core's panel). Web pages never share anything with Jarvis's own UI: they run in their
 * own persistent session (cookies and logins stay here, apart from the app), sandboxed, with no
 * preload and no IPC, every permission denied, and http/https only. The address bar above them is
 * a local page whose preload can only ask main to go, go back/forward, reload or stop.
 */

const PARTITION = 'persist:jarvis-browser';
const BAR_HEIGHT = 46;
/** Page text handed to Jarvis is capped; it is untrusted content either way. */
const MAX_TEXT = 30_000;
/** Isolated world for Jarvis's own scripts: the page can't see or change their variables. */
const WORLD = 1001;
/** After a click or key, wait at most this long for a page to start and finish loading. */
const SETTLE_MS = 4000;
/** Keys Jarvis may press in a page. */
export const BROWSER_KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Backspace',
] as const;
export type BrowserKey = (typeof BROWSER_KEYS)[number];

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

const Nav = z.enum(['back', 'forward', 'reload', 'stop', 'home']);

let pageSession: Session | null = null;
function browserSession(): Session {
  if (pageSession) return pageSession;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  pageSession = ses;
  return ses;
}

const isWeb = (url: string): boolean => /^https?:$/i.test(safeProtocol(url));
function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

const BROWSER_ERRORS: Record<string, string> = {
  stale: 'That control is no longer on the page; take a new snapshot.',
  hidden: 'That control is not visible; scroll or take a new snapshot.',
  secret: 'That is a password, card or code field: sir must type those himself.',
  'not-text': 'That control is not a text field.',
  'not-select': 'That control is not a drop-down list.',
  'no-option': 'No such option. The options are',
  covered:
    'Something else is on top of that control (a banner or overlay); close it or scroll, then take a new snapshot.',
  'focus-moved':
    'The page moved the typing cursor somewhere else, so nothing was typed; take a new snapshot.',
  changed: 'That control changed since the snapshot; take a new snapshot before clicking it.',
};

function pressKey(wc: Electron.WebContents, key: BrowserKey): void {
  wc.sendInputEvent({ type: 'keyDown', keyCode: key });
  if (key === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: key });
}

export function createJarvisBrowser(
  hooks: {
    /** Bring the browser on screen (beside the orb) when it opens or Jarvis acts in it. */
    present?(): void;
    /** Its views were closed ("close the browser", Ctrl+W). */
    onClosed?(): void;
  } = {},
) {
  let bar: WebContentsView | null = null;
  let page: WebContentsView | null = null;
  /** Controls listed by the latest snapshot of the open page (ref → what it is). */
  const refs = new Map<string, RefInfo>();

  const state = (): BrowserState | null =>
    page && !page.webContents.isDestroyed()
      ? {
          url: page.webContents.getURL(),
          title: page.webContents.getTitle(),
          canGoBack: page.webContents.navigationHistory.canGoBack(),
          canGoForward: page.webContents.navigationHistory.canGoForward(),
          loading: page.webContents.isLoading(),
        }
      : null;

  const push = (): void => {
    const s = state();
    if (s && bar && !bar.webContents.isDestroyed()) bar.webContents.send('browser:state', s);
  };

  const fromBar = (e: IpcMainEvent): boolean =>
    !!bar &&
    !bar.webContents.isDestroyed() &&
    e.sender === bar.webContents &&
    (e.senderFrame?.url ?? '').endsWith('/browser-bar.html');

  ipcMain.on('browser:go', (e, raw: unknown) => {
    if (!fromBar(e) || typeof raw !== 'string' || raw.length > 2000) return;
    const url = addressFor(raw);
    // Local addresses are fine (Sir's dev servers), as with open_url.
    if (urlGuard(url, { allowPrivate: true }).ok) void page?.webContents.loadURL(url);
  });
  function navigate(action: z.infer<typeof Nav>): boolean {
    if (!page) return false;
    const wc = page.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward())
      wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'stop') wc.stop();
    else if (action === 'home') void wc.loadURL(HOME);
    return true;
  }

  ipcMain.on('browser:nav', (e, raw: unknown) => {
    const nav = Nav.safeParse(raw);
    if (fromBar(e) && nav.success) navigate(nav.data);
  });
  ipcMain.on('browser:ready', (e) => {
    if (fromBar(e)) push();
  });

  function guardPage(view: WebContentsView): void {
    const wc = view.webContents;
    // New tabs/windows open in place; only web addresses.
    wc.setWindowOpenHandler(({ url }) => {
      if (isWeb(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    // Web addresses only; a public page may not send the browser to this PC or the home network.
    const onlyWeb = (event: Electron.Event, url: string): void => {
      const fromPrivate = !urlGuard(wc.getURL(), { allowPrivate: false }).ok;
      if (!isWeb(url) || (!fromPrivate && !urlGuard(url, { allowPrivate: false }).ok))
        event.preventDefault();
    };
    wc.on('render-process-gone', () => wc.reload());
    // Refs belong to one page: a new document makes the old ones meaningless.
    // Refs belong to one page view: a new document or an in-page route change makes them stale.
    wc.on('did-navigate', () => refs.clear());
    wc.on('did-navigate-in-page', () => refs.clear());
    wc.on('will-navigate', onlyWeb);
    wc.on('will-redirect', onlyWeb);
    wc.on('will-attach-webview', (event) => event.preventDefault());
    for (const ev of [
      'did-start-loading',
      'did-stop-loading',
      'did-navigate',
      'did-navigate-in-page',
      'page-title-updated',
    ] as const)
      wc.on(ev as 'did-stop-loading', push);
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if ((input.control && key === 'l') || key === 'f6') {
        event.preventDefault();
        bar?.webContents.focus();
        bar?.webContents.send('browser:focusAddress');
      } else if (input.control && key === 'w') {
        event.preventDefault();
        closeViews();
      } else if (key === 'f5' || (input.control && key === 'r')) {
        event.preventDefault();
        wc.reload();
      } else if (input.alt && key === 'arrowleft' && wc.navigationHistory.canGoBack()) {
        wc.navigationHistory.goBack();
      } else if (input.alt && key === 'arrowright' && wc.navigationHistory.canGoForward()) {
        wc.navigationHistory.goForward();
      }
    });
  }

  /** Frees both views' renderers (cookies and logins stay in the browser's own partition). */
  function closeViews(): void {
    for (const v of [bar, page]) if (v && !v.webContents.isDestroyed()) v.webContents.close();
    bar = page = null;
    refs.clear();
    hooks.onClosed?.();
  }

  function ensure(): { page: WebContentsView; created: boolean } {
    if (page && bar && !page.webContents.isDestroyed() && !bar.webContents.isDestroyed())
      return { page, created: false };
    const b = new WebContentsView({
      webPreferences: {
        ...HARDENED_WEB_PREFERENCES,
        preload: join(__dirname, '../preload/browser-bar.js'),
      },
    });
    hardenWebContents(b.webContents);
    // The bar never navigates (a dropped file would otherwise load with its preload).
    b.webContents.on('will-navigate', (event) => event.preventDefault());
    const p = new WebContentsView({
      webPreferences: { ...HARDENED_WEB_PREFERENCES, session: browserSession() },
    });
    guardPage(p);
    bar = b;
    page = p;
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) void b.webContents.loadURL(`${devUrl}/browser-bar.html`);
    else void b.webContents.loadFile(join(__dirname, '../renderer/browser-bar.html'));
    return { page: p, created: true };
  }

  function requirePage(): Electron.WebContents {
    if (!page || page.webContents.isDestroyed()) throw new Error('Jarvis Browser is not open.');
    // Sir sees what Jarvis does in it.
    hooks.present?.();
    return page.webContents;
  }

  /** Runs one of browser-dom's scripts; its { error } answers become plain reasons. */
  async function inPage<T>(wc: Electron.WebContents, code: string): Promise<T> {
    const r = (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }])) as T & {
      error?: string;
      options?: string[];
    };
    if (r && typeof r === 'object' && r.error) {
      const why = BROWSER_ERRORS[r.error] ?? r.error;
      throw new Error(r.options ? `${why}: ${r.options.join(', ')}.` : why);
    }
    return r;
  }

  /** Waits for a navigation the action may have started, up to SETTLE_MS. */
  function settle(wc: Electron.WebContents): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        wc.off('did-stop-loading', done);
        resolve();
      };
      const timer = setTimeout(done, SETTLE_MS);
      setTimeout(() => {
        if (wc.isDestroyed() || !wc.isLoading()) done();
        else wc.once('did-stop-loading', done);
      }, 400);
    });
  }

  return {
    /** Opens (or reuses) the window; local addresses are allowed, as with open_url (dev servers). */
    open(url?: string): { ok: true } | { ok: false; reason: string } {
      const target = url ? addressFor(url) : HOME;
      const guard = urlGuard(target, { allowPrivate: true });
      if (!guard.ok) return { ok: false, reason: guard.reason };
      const { page: p, created } = ensure();
      if (url || created) void p.webContents.loadURL(target);
      hooks.present?.();
      return { ok: true };
    },
    state,
    /** Visible text of the open page, read in an isolated world so the page can't fake it. */
    async readPage(): Promise<{ url: string; title: string; text: string } | null> {
      const s = state();
      if (!s || !page) return null;
      const text = (await page.webContents.executeJavaScriptInIsolatedWorld(1001, [
        { code: `(document.body ? document.body.innerText : '').slice(0, ${MAX_TEXT})` },
      ])) as unknown;
      return {
        url: s.url,
        title: s.title,
        text: typeof text === 'string' ? text.slice(0, MAX_TEXT) : '',
      };
    },
    navigate,

    /** Accessibility-style outline of the open page with refs for its controls (browser-dom.ts). */
    async snapshot(): Promise<Snapshot | null> {
      if (!state() || !page) return null;
      const snap = (await page.webContents.executeJavaScriptInIsolatedWorld(WORLD, [
        { code: SNAPSHOT_JS },
      ])) as Snapshot;
      refs.clear();
      for (const r of snap.refs) refs.set(r.ref, r);
      return snap;
    },

    /** What a ref from the latest snapshot is (undefined once the page changed). */
    refInfo: (ref: string): RefInfo | undefined => refs.get(ref),

    /** A real mouse click in the middle of the control (trusted input, like Sir's own). */
    async click(ref: string): Promise<void> {
      const wc = requirePage();
      const at = await inPage<{ x: number; y: number; name: string; type: string; text: string }>(
        wc,
        pointJs(ref),
      );
      // The tier and confirmation described the control as it was at the snapshot: refuse if it now
      // says something else, or became something that commits (a relabelled "Pay").
      const before = refs.get(ref);
      if (!before || before.name !== at.name || (isRiskyClick(at) && !isRiskyClick(before)))
        throw new Error(BROWSER_ERRORS['changed']);
      wc.focus();
      wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
      wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await settle(wc);
    },

    /** Types into a text field as real keystrokes; secret fields are refused in the page. */
    async type(
      ref: string,
      text: string,
      opts: { clear: boolean; submit: boolean },
    ): Promise<void> {
      const wc = requirePage();
      await inPage(wc, focusJs(ref, opts.clear));
      wc.focus();
      await wc.insertText(text);
      if (opts.submit) {
        pressKey(wc, 'Enter');
        await settle(wc);
      }
    },

    async select(ref: string, option: string): Promise<string> {
      const wc = requirePage();
      const r = await inPage<{ chosen: string }>(wc, selectJs(ref, option));
      return r.chosen;
    },

    async press(key: BrowserKey): Promise<void> {
      const wc = requirePage();
      wc.focus();
      pressKey(wc, key);
      await settle(wc);
    },

    async scroll(direction: 'up' | 'down' | 'top' | 'bottom'): Promise<{ y: number; max: number }> {
      const wc = requirePage();
      return (await wc.executeJavaScriptInIsolatedWorld(WORLD, [
        { code: scrollJs(direction) },
      ])) as {
        y: number;
        max: number;
      };
    },
    close(): void {
      closeViews();
    },
    isOpen: (): boolean => !!page && !page.webContents.isDestroyed(),
    /** Dock (ADR-040): the address bar on top, the page below. */
    views(): Array<{ view: WebContentsView; height: number | null }> {
      ensure();
      return bar && page
        ? [
            { view: bar, height: BAR_HEIGHT },
            { view: page, height: null },
          ]
        : [];
    },
  };
}

export type JarvisBrowser = ReturnType<typeof createJarvisBrowser>;
