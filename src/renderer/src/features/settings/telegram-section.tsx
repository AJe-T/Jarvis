import { useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { SecretField } from './secret-field';
import { SettingSwitch } from './settings-controls';

type Status = Res<'telegram:status'>;

/** Telegram channel (ideas from OpenJarvis): chat with Jarvis from your phone through your own bot. */
export function TelegramSection(): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    void call('telegram:status', {}).then(setStatus);
    return window.jarvis.on('telegram:status', setStatus);
  }, []);
  return (
    <Section
      title="Telegram"
      description="Talk to Jarvis from your phone. Create a bot with @BotFather in Telegram, paste its token here, turn it on, then send the pairing code to your bot. Only that one chat is answered. Replies pass through Telegram's servers; actions that delete or overwrite things can only be approved at this PC."
    >
      <SecretField name="telegram" label="Bot token (from @BotFather)" />
      <SettingSwitch k="telegram.enabled" label="Turn on the Telegram channel" />
      <SettingSwitch
        k="telegram.forwardAutomations"
        label="Also send briefings and scheduled task results to Telegram"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => void call('telegram:restart', {}).then(setStatus)}>
          Connect / reconnect
        </Button>
        {status?.paired && (
          <Button variant="ghost" onClick={() => void call('telegram:unpair', {})}>
            Unpair phone
          </Button>
        )}
      </div>
      {status && (
        <div
          role="status"
          className="max-w-xl rounded-md border border-line p-3 text-sm text-ink-100"
        >
          {status.error ? (
            <p className="text-alarm-500">{status.error}</p>
          ) : !status.running ? (
            <p className="text-ink-300">Not connected.</p>
          ) : status.paired ? (
            <p>✓ Connected as @{status.botName} and paired with your phone.</p>
          ) : (
            <p>
              Connected as @{status.botName}. Send this code to your bot to pair:{' '}
              <span className="font-code text-lg text-accent-300">{status.pairingCode}</span>
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
