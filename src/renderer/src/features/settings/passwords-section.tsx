import { Section } from '../../components/ui/field';
import { SettingInput } from './settings-controls';

/** Password manager options (the vault itself is in the Passwords view). */
export function PasswordsSection(): React.JSX.Element {
  return (
    <Section
      title="Password manager"
      description="Your vault is encrypted on this PC with a key made from your master password (scrypt + AES-256-GCM). Jarvis's AI, memory, logs, Telegram, WhatsApp and the phone remote cannot read it. It also locks when Windows locks or sleeps, and when you press the kill switch."
    >
      <SettingInput
        k="passwords.autoLockMinutes"
        label="Lock after this many idle minutes"
        type="number"
        hint="0 = only when you lock it, Windows locks, or the PC sleeps."
      />
      <SettingInput
        k="passwords.clipboardSeconds"
        label="Clear copied passwords from the clipboard after (seconds)"
        type="number"
      />
    </Section>
  );
}
