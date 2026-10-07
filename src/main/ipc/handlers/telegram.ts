import type { TelegramChannel } from '../../channels/telegram';
import type { Services } from '../../services';
import { emit } from '../emit';
import { handle } from '../handle';

/** Settings → Telegram. The pairing code is shown only here; pairing itself happens in main. */
export function registerTelegramHandlers(s: Services, tg: TelegramChannel): void {
  tg.onStatus(() => emit('telegram:status', tg.status()));
  handle('telegram:status', () => tg.status());
  handle('telegram:restart', async () => {
    tg.stop();
    await tg.start();
    return tg.status();
  });
  handle('telegram:unpair', () => {
    tg.unpair();
    return { ok: true };
  });
  s.settings.onChange((key) => {
    if (key !== 'telegram.enabled') return;
    if (s.settings.get('telegram.enabled')) void tg.start();
    else tg.stop();
  });
}
