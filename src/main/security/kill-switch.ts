import { JarvisError } from '../errors';

/**
 * Security.md §11. Each "generation" has an AbortController; trigger() aborts everything started in
 * the current generation (Claude streams, tools, PowerShell, TTS, computer use) and starts a new one.
 */
export interface KillSwitch {
  /** Signal for work starting now. Aborted when the kill switch fires. */
  signal(): AbortSignal;
  trigger(reason: string): void;
  onKill(listener: (reason: string) => void): () => void;
  throwIfAborted(signal: AbortSignal): void;
}

export function createKillSwitch(): KillSwitch {
  let controller = new AbortController();
  const listeners = new Set<(reason: string) => void>();
  return {
    signal: () => controller.signal,
    trigger(reason) {
      const old = controller;
      controller = new AbortController();
      old.abort(new JarvisError('KILLED', `kill switch: ${reason}`, 'All activity stopped.'));
      for (const l of listeners) {
        try {
          l(reason);
        } catch {
          // A failing listener must not stop the others from halting their work.
        }
      }
    },
    onKill(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    throwIfAborted(signal) {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new JarvisError('CANCELLED', 'aborted');
      }
    },
  };
}

/** One AbortSignal that fires when any input fires. */
export function anySignal(...signals: AbortSignal[]): AbortSignal {
  return AbortSignal.any(signals);
}
