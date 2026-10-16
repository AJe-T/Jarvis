import { app, type BrowserWindow } from 'electron';
import { EVENTS, type EventPayload } from '@shared/ipc-contract';
import type { EventChannel } from '@shared/ipc-channels';
import { logger } from '../logging/logger';

const targets = new Set<BrowserWindow>();
type Tap = (event: EventChannel, payload: unknown) => void;
const taps = new Set<Tap>();

/** Main-side listeners for app events (the dock hides app views while a confirmation is open). */
export function onEmit(tap: Tap): void {
  taps.add(tap);
}

export function addEventTarget(win: BrowserWindow): void {
  targets.add(win);
  win.on('closed', () => targets.delete(win));
}

/** Code-style.md §5: typed main → renderer events; payloads validated in dev builds. */
export function emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void {
  if (!app.isPackaged) {
    const parsed = EVENTS[event].safeParse(payload);
    if (!parsed.success)
      logger.error({ event, issues: parsed.error.issues.slice(0, 3) }, 'invalid event payload');
  }
  for (const tap of taps) tap(event, payload);
  for (const win of targets) {
    if (!win.isDestroyed()) win.webContents.send(event, payload);
  }
}
