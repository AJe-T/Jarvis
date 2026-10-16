import { join } from 'node:path';
import { WebContentsView, app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { HARDENED_WEB_PREFERENCES, hardenWebContents } from '../windows/hardening';
import type { TermEntry, Terminal } from './terminal';

/**
 * ADR-032/040 Jarvis Terminal. Its page is local and its preload can only run, stop, list and clear
 * terminal commands; main answers only that page's webContents (never the main UI), so nothing else
 * in Jarvis gains a way to run commands without Sir's approval. It is shown beside the orb: the
 * dock (apps/dock.ts) places its view over Core's panel.
 */

const Command = z.string().trim().min(1).max(10_000);

export function createTerminalWindow(term: Terminal, hooks: { present?(): void } = {}) {
  let view: WebContentsView | null = null;
  const live = (): WebContentsView | null =>
    view && !view.webContents.isDestroyed() ? view : null;
  const fromTerminal = (e: IpcMainInvokeEvent): boolean =>
    !!live() &&
    e.sender === view?.webContents &&
    (e.senderFrame?.url ?? '').endsWith('/terminal.html');
  const only =
    <T>(fn: (raw: unknown) => T) =>
    (e: IpcMainInvokeEvent, raw: unknown): T => {
      if (!fromTerminal(e)) throw new Error('not the terminal window');
      return fn(raw);
    };

  ipcMain.handle(
    'terminal:run',
    only((raw) => term.run(Command.parse(raw))),
  );
  ipcMain.handle(
    'terminal:history',
    only(() => ({ entries: term.history(), cwd: term.cwd() })),
  );
  ipcMain.handle(
    'terminal:clear',
    only(() => term.clear()),
  );
  ipcMain.handle(
    'terminal:stop',
    only(() => term.stop()),
  );

  function ensure(): WebContentsView {
    const existing = live();
    if (existing) return existing;
    const v = new WebContentsView({
      webPreferences: {
        ...HARDENED_WEB_PREFERENCES,
        preload: join(__dirname, '../preload/terminal.js'),
      },
    });
    v.setBackgroundColor('#0b0f14');
    hardenWebContents(v.webContents);
    // The terminal never navigates (a dropped file would otherwise load with its preload).
    v.webContents.on('will-navigate', (event) => event.preventDefault());
    view = v;
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!app.isPackaged && devUrl) void v.webContents.loadURL(`${devUrl}/terminal.html`);
    else void v.webContents.loadFile(join(__dirname, '../renderer/terminal.html'));
    return v;
  }

  return {
    /** Shows the terminal beside the orb. */
    open(): void {
      hooks.present?.();
    },
    /** Dock (ADR-040): one view filling the panel; it keeps its history while hidden. */
    views(): Array<{ view: WebContentsView; height: number | null }> {
      return [{ view: ensure(), height: null }];
    },
    /** A new entry (e.g. something Jarvis ran) for the open terminal. */
    push(entry: TermEntry): void {
      live()?.webContents.send('terminal:entry', entry);
    },
  };
}

export type TerminalWindow = ReturnType<typeof createTerminalWindow>;
