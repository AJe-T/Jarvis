import { createWhatsAppTool, type WhatsAppChannel } from '../../channels/whatsapp';
import type { Services } from '../../services';
import { emit } from '../emit';
import { handle } from '../handle';

/** Settings → Phone & chat apps → WhatsApp. The QR code is shown only here. */
export function registerWhatsAppHandlers(s: Services, wa: WhatsAppChannel): void {
  s.registry.register(createWhatsAppTool(wa));
  wa.onStatus(() => emit('whatsapp:status', wa.status()));
  handle('whatsapp:status', () => wa.status());
  handle('whatsapp:restart', async () => {
    wa.stop();
    await wa.start();
    return wa.status();
  });
  handle('whatsapp:logout', async () => {
    await wa.logout();
    s.settings.set('whatsapp.enabled', false);
    return { ok: true };
  });
  s.settings.onChange((key) => {
    if (key !== 'whatsapp.enabled') return;
    if (s.settings.get('whatsapp.enabled')) void wa.start();
    else wa.stop();
  });
}
