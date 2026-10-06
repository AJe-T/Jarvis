import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { INVOKE, SEND, type ParsedReq, type Res, type SendPayload } from '@shared/ipc-contract';
import type { InvokeChannel, SendChannel } from '@shared/ipc-channels';
import { JarvisError, errorMessage } from '../errors';
import { logger } from '../logging/logger';
import { isAppUrl } from '../windows/hardening';

const log = logger.child({ module: 'ipc' });

function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!isAppUrl(url)) throw new JarvisError('IPC_FORBIDDEN', `IPC from untrusted frame ${url}`);
}

/**
 * Security.md §7 / API-Guide.md §1.4: every handler checks the sender, validates the request with Zod,
 * and validates its own response. Errors reach the renderer as a short, Sir-safe message only.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (req: ParsedReq<C>, event: IpcMainInvokeEvent) => Promise<Res<C>> | Res<C>,
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    try {
      assertTrustedSender(event);
      const req = INVOKE[channel].request.parse(raw) as ParsedReq<C>;
      const res = await fn(req, event);
      return INVOKE[channel].response.parse(res) as Res<C>;
    } catch (err) {
      log.warn({ channel, err: errorMessage(err) }, 'ipc handler failed');
      const message =
        err instanceof JarvisError && err.userMessage
          ? err.userMessage
          : 'That request failed. Details are in the log.';
      throw new Error(message, { cause: err });
    }
  });
}

export function onSend<S extends SendChannel>(
  channel: S,
  fn: (payload: SendPayload<S>) => void,
): void {
  ipcMain.on(channel, (event, raw: unknown) => {
    try {
      assertTrustedSender(event);
      // Narrowing: SEND[channel] is the schema for S, so its output is SendPayload<S>.
      fn(SEND[channel].parse(raw) as SendPayload<S>);
    } catch (err) {
      log.warn({ channel, err: errorMessage(err) }, 'ipc send rejected');
    }
  });
}
