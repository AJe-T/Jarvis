import type { Req, Res } from '@shared/ipc-contract';
import type { InvokeChannel } from '@shared/ipc-channels';

/** Typed access to the preload bridge. Errors carry a short, Sir-safe message from main. */
export function call<C extends InvokeChannel>(channel: C, req: Req<C>): Promise<Res<C>> {
  return window.jarvis.call[channel](req);
}

/** Electron prefixes rejected invoke errors with "Error invoking remote method 'x': Error: ". */
export function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
