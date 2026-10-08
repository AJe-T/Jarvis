import QRCode from 'qrcode';
import type { PhoneRemote, RemoteStatus } from '../../channels/phone-remote';
import type { Services } from '../../services';
import { emit } from '../emit';
import { handle } from '../handle';

async function withQr(st: RemoteStatus): Promise<RemoteStatus & { pairingQr: string | null }> {
  const pairingQr = st.pairingUrl
    ? await QRCode.toDataURL(st.pairingUrl, { margin: 1, width: 240 }).catch(() => null)
    : null;
  return { ...st, pairingQr };
}

/** Settings → Phone. The pairing code and QR are shown only here. */
export function registerRemoteHandlers(s: Services, remote: PhoneRemote): void {
  remote.onStatus(() => void withQr(remote.status()).then((st) => emit('remote:status', st)));
  handle('remote:status', () => withQr(remote.status()));
  handle('remote:pair', () => withQr(remote.newPairingCode()));
  handle('remote:revoke', (req) => {
    remote.revoke(req.id);
    return { ok: true };
  });
  handle('remote:restart', async () => {
    remote.stop();
    await remote.start();
    return withQr(remote.status());
  });
  s.settings.onChange((key) => {
    if (key !== 'remote.enabled' && key !== 'remote.port') return;
    remote.stop();
    if (s.settings.get('remote.enabled')) void remote.start();
  });
}
