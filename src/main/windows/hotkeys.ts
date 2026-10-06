import { globalShortcut } from 'electron';
import { logger } from '../logging/logger';

export interface HotkeyBindings {
  kill: string;
  toggleWindow: string;
  ptt: string;
}

export interface HotkeyHandlers {
  kill(): void;
  toggleWindow(): void;
  ptt(): void;
}

/**
 * Registers global shortcuts (they work while the app is minimised). Returns the accelerators that
 * Windows refused (already taken by another app) so the UI can say so.
 */
export function registerHotkeys(b: HotkeyBindings, h: HotkeyHandlers): string[] {
  globalShortcut.unregisterAll();
  const failed: string[] = [];
  const bind = (accel: string, fn: () => void): void => {
    try {
      if (!globalShortcut.register(accel, fn)) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  };
  bind(b.kill, h.kill);
  bind(b.toggleWindow, h.toggleWindow);
  bind(b.ptt, h.ptt);
  if (failed.length) logger.warn({ failed }, 'some global hotkeys could not be registered');
  return failed;
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}
