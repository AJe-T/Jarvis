import { Section } from '../../components/ui/field';
import { Button } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SecretField } from './secret-field';
import { SettingInput, SettingSelect, SettingSwitch } from './settings-controls';

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
      <SettingSelect
        k="appearance.theme"
        label="Theme"
        options={[
          { value: 'system', label: 'Match Windows' },
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
      />
      <SettingSwitch
        k="appearance.orbMusic"
        label="The orb moves to music playing on this PC (only the loudness is read; nothing is recorded)"
      />
    </Section>
  );
}

/** Everyday tools: weather location, units, nutrition target. */
export function EverydaySection(): React.JSX.Element {
  const set = useSettingsStore((s) => s.set);
  const toast = useUiStore((s) => s.toast);
  return (
    <>
      <Section
        title="Everyday"
        description="Used by the weather and meal-log tools. Your town is only sent to Open-Meteo when you ask about the weather."
      >
        <div className="flex flex-wrap items-end gap-3">
          <SettingInput k="location.home" label="Home town (e.g. Hyderabad, India)" />
          <Button
            variant="ghost"
            title="Looks up your town from your internet connection (sends your IP address to ipapi.co once)"
            onClick={() =>
              void call('location:detect', {})
                .then((r) => set('location.home', r.town))
                .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
            }
          >
            Detect
          </Button>
        </div>
        <SettingSelect
          k="units.temperature"
          label="Temperature"
          options={[
            { value: 'celsius', label: 'Celsius' },
            { value: 'fahrenheit', label: 'Fahrenheit' },
          ]}
        />
        <SettingInput
          k="nutrition.dailyCalories"
          label="Daily calorie target (meal log)"
          type="number"
          step={50}
        />
      </Section>
      <Section
        title="AI models (Hugging Face)"
        description="Lets Jarvis pick and run expert models from the Hugging Face Hub (image recognition, object detection, transcription, translation, image generation), the HuggingGPT idea from microsoft/JARVIS. Create a free read token at huggingface.co/settings/tokens. Files are only sent after you confirm."
      >
        <SecretField name="huggingface" label="Hugging Face token" placeholder="hf_…" />
      </Section>
    </>
  );
}
