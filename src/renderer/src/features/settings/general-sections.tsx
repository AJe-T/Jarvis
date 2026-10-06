import { Section } from '../../components/ui/field';
import { SettingInput, SettingSwitch } from './settings-controls';

export function HotkeysSection(): React.JSX.Element {
  return (
    <Section
      title="Hotkeys"
      description="Global shortcuts work even when Jarvis is minimised. Use Electron accelerator format, e.g. Ctrl+Alt+Space."
    >
      <div className="grid max-w-md gap-4">
        <SettingInput k="hotkeys.kill" label="Stop everything (kill switch)" />
        <SettingInput k="hotkeys.ptt" label="Press to talk" />
        <SettingInput k="hotkeys.toggleWindow" label="Show / hide Jarvis" />
      </div>
    </Section>
  );
}

export function PrivacySection(): React.JSX.Element {
  return (
    <Section
      title="Privacy"
      description="Start a message with /private to keep that conversation out of Obsidian and memory."
    >
      <SettingSwitch k="privacy.logConversationsToVault" label="Save conversations to Obsidian" />
      <SettingInput
        k="retention.messagesDays"
        label="Delete chat history older than (days, 0 = keep forever)"
        type="number"
        step={1}
      />
    </Section>
  );
}

export function GeneralSection(): React.JSX.Element {
  return (
    <Section title="General">
      <SettingSwitch
        k="app.closeToTray"
        label="Closing the window keeps Jarvis running in the tray"
      />
      <SettingSwitch k="app.startWithWindows" label="Start Jarvis when Windows starts" />
      <SettingSwitch k="app.startHidden" label="Start hidden in the tray" />
    </Section>
  );
}
