import { useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SettingInput, SettingSwitch } from './settings-controls';
import { TelegramSection } from './telegram-section';

type Remote = Res<'remote:status'>;
type WhatsApp = Res<'whatsapp:status'>;

const box = 'max-w-xl rounded-md border border-line p-3 text-sm text-ink-100';

/** Phone remote: a web app on the home network with live dictation and hands-free calls. */
function PhoneRemote(): React.JSX.Element {
  const [st, setSt] = useState<Remote | null>(null);
  const enabled = useSetting('remote.enabled');
  const toast = useUiStore((s) => s.toast);
  useEffect(() => {
    void call('remote:status', {}).then(setSt);
    return window.jarvis.on('remote:status', setSt);
  }, []);

  return (
    <Section
      title="Phone remote (free, no app to install)"
      description="Open Jarvis in your phone's browser on the same Wi-Fi: type, dictate with live words, or tap 📞 for a hands-free voice call. Your phone does the speech recognition and reads replies aloud. The connection is encrypted with a certificate made on this PC; the first time, your phone warns that it's self-signed — tap Advanced → Proceed."
    >
      <SettingSwitch k="remote.enabled" label="Turn on the phone remote" />
      <SettingInput
        k="remote.port"
        label="Port"
        type="number"
        hint="Change only if another app uses 8765."
      />
      {enabled && st && (
        <div role="status" className={box}>
          {st.error ? (
            <p className="text-alarm-500">{st.error}</p>
          ) : !st.running ? (
            <p className="text-ink-300">Starting…</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p>
                ✓ Running at{' '}
                {st.urls.map((u) => (
                  <span key={u} className="mr-2 font-code text-accent-300">
                    {u}
                  </span>
                ))}
              </p>
              {st.pairingQr && st.pairingCode ? (
                <div className="flex flex-wrap items-center gap-4">
                  <img
                    src={st.pairingQr}
                    alt="QR code to pair your phone"
                    width={180}
                    height={180}
                    className="rounded-md bg-white p-1"
                  />
                  <div className="flex flex-col gap-1">
                    <p>Scan with your phone's camera, or open the address above and type:</p>
                    <p className="font-code text-2xl tracking-[0.3em] text-accent-300">
                      {st.pairingCode}
                    </p>
                    <p className="text-xs text-ink-500">Valid for 10 minutes, once.</p>
                  </div>
                </div>
              ) : (
                <Button
                  variant="primary"
                  className="self-start"
                  onClick={() =>
                    void call('remote:pair', {})
                      .then(setSt)
                      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
                  }
                >
                  Pair a phone
                </Button>
              )}
              {st.devices.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {st.devices.map((d) => (
                    <li key={d.id} className="flex items-center gap-2">
                      📱 {d.name}
                      <span className="text-xs text-ink-500">
                        {d.lastSeen
                          ? `last used ${new Date(d.lastSeen).toLocaleString()}`
                          : 'not used yet'}
                      </span>
                      <button
                        type="button"
                        className="ml-auto text-xs text-alarm-500 underline"
                        onClick={() => void call('remote:revoke', { id: d.id })}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-ink-500">
                Away from home? Install the free Tailscale app on the PC and phone, then run{' '}
                <span className="font-code">tailscale serve --bg {st.port}</span> on the PC and open
                the https://…ts.net address on your phone (a real certificate, no warning).
              </p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** WhatsApp through Baileys as a linked device: Sir messages himself "Jarvis, …". */
function WhatsAppSection(): React.JSX.Element {
  const [st, setSt] = useState<WhatsApp | null>(null);
  const enabled = useSetting('whatsapp.enabled');
  const prefix = useSetting('whatsapp.prefix') ?? 'Jarvis';
  useEffect(() => {
    void call('whatsapp:status', {}).then(setSt);
    return window.jarvis.on('whatsapp:status', setSt);
  }, []);

  async function logout(): Promise<void> {
    const yes = await confirmAction({
      title: 'Unlink WhatsApp from this PC?',
      body: 'Jarvis stops reading your "Message yourself" chat and forgets the WhatsApp session.',
      actionLabel: 'Unlink',
      destructive: true,
    });
    if (yes) await call('whatsapp:logout', {});
  }

  return (
    <Section
      title="WhatsApp"
      description={`Link Jarvis like WhatsApp Web, then talk to him in your own "Message yourself" chat: start a message with "${prefix || '…'}" (e.g. "${prefix || 'Jarvis'}, remind me at 6 to call mom"). Other chats are never read as commands. Jarvis can also send a message for you, always after you approve the text.`}
    >
      <p className="max-w-xl rounded-md border border-lamp-400/40 bg-lamp-tint px-3 py-2 text-sm text-lamp-tag-ink">
        Unofficial: this uses the free Baileys library, not WhatsApp's business API. WhatsApp may
        restrict accounts that use unofficial clients. Consider a spare number.
      </p>
      <SettingSwitch k="whatsapp.enabled" label="Turn on WhatsApp" />
      <SettingInput
        k="whatsapp.prefix"
        label="Wake word for messages to yourself"
        hint="Leave empty to treat every message to yourself as a command."
      />
      <SettingSwitch
        k="whatsapp.forwardAutomations"
        label="Send briefings and scheduled task results to my WhatsApp"
      />
      {enabled && st && (
        <div role="status" className={box}>
          {st.state === 'qr' && st.qr ? (
            <div className="flex flex-wrap items-center gap-4">
              <img
                src={st.qr}
                alt="WhatsApp QR code"
                width={200}
                height={200}
                className="rounded-md bg-white p-1"
              />
              <p className="max-w-60">
                On your phone: WhatsApp → Settings → Linked devices → Link a device, and scan this
                code.
              </p>
            </div>
          ) : st.state === 'open' ? (
            <div className="flex items-center gap-3">
              <p>✓ Linked{st.me ? ` to +${st.me}` : ''}. Message yourself to talk to Jarvis.</p>
              <Button variant="ghost" className="ml-auto" onClick={() => void logout()}>
                Unlink
              </Button>
            </div>
          ) : st.state === 'error' ? (
            <div className="flex items-center gap-3">
              <p className="text-alarm-500">{st.error}</p>
              <Button variant="ghost" onClick={() => void call('whatsapp:restart', {}).then(setSt)}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="text-ink-300">Connecting to WhatsApp…</p>
          )}
        </div>
      )}
    </Section>
  );
}

/** Settings → Phone & chat apps: every way to reach Jarvis away from the keyboard. */
export function PhoneSection(): React.JSX.Element {
  return (
    <>
      <PhoneRemote />
      <WhatsAppSection />
      <TelegramSection />
      <Section title="Telegram voice notes">
        <SettingSwitch
          k="telegram.voiceReplies"
          label="Answer voice notes with a voice message as well as text"
        />
      </Section>
    </>
  );
}
