import { PERSONAS } from '@shared/personas';
import { Section } from '../../components/ui/field';
import { Button } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { AccentPicker } from './accent-picker';
import { TextSizePicker, ThemePicker } from './appearance-pickers';
import { OrbStylePicker } from './orb-style-picker';
import { SecretField } from './secret-field';
import { SettingInput, SettingSelect, SettingSwitch } from './settings-controls';
import { StylePicker } from './style-picker';

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
      <SettingInput
        k="assistant.name"
        label="Assistant name: what you call it and what it calls itself. The wake word follows it, so with “April” you say “Hey April”."
        hint="Letters only, 2–20 characters. Short, distinct names (April, Friday, Nova) are heard best."
      />
      <SettingSwitch
        k="app.closeToTray"
        label="Closing the window keeps Jarvis running in the tray"
      />
      <SettingSwitch k="app.startWithWindows" label="Start Jarvis when Windows starts" />
      <SettingSwitch k="app.startHidden" label="Start hidden in the tray" />
      <StylePicker />
      <ThemePicker />
      <TextSizePicker />
      <AccentPicker />
      <OrbStylePicker />
      <SettingSwitch
        k="appearance.orbMusic"
        label="The orb moves to music playing on this PC (only the loudness is read; nothing is recorded)"
      />
      <SettingSwitch
        k="appearance.orbMood"
        label="The orb shows Jarvis's mood: each reply tints it (warm when happy, amber when concerned, calmer when serious)"
      />
      <SettingSelect
        k="persona"
        label="Personality: Butler (classic), Concise, Friendly, Sarcastic or Coach. You can also just say “be more concise”."
        options={PERSONAS.map((p) => ({ value: p.id, label: p.label }))}
      />
      <QuietMode />
    </Section>
  );
}

const QUIET_CHOICES = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 180, label: '3 hours' },
] as const;

/** Quiet mode (do not disturb): reminders and automations arrive silently, in the app only. */
function QuietMode(): React.JSX.Element {
  const until = useSetting('quiet.until') ?? 0;
  const set = useSettingsStore((s) => s.set);
  const on = until > Date.now();
  const save = (value: number): void => void set('quiet.until', value);
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-100">Quiet mode</legend>
      <p className="mb-2 text-xs text-ink-500">
        {on
          ? `On until ${new Date(until).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}: reminders and briefings arrive silently in the app (no pop-ups, nothing spoken).`
          : 'Off. Say “be quiet for an hour”, or pick a length: reminders and briefings then arrive silently in the app.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {QUIET_CHOICES.map((c) => (
          <Button key={c.minutes} onClick={() => save(Date.now() + c.minutes * 60_000)}>
            {c.label}
          </Button>
        ))}
        {on && (
          <Button variant="ghost" onClick={() => save(0)}>
            Turn off
          </Button>
        )}
      </div>
    </fieldset>
  );
}

/** Everyday tools: weather location, units, nutrition target. */
export function EverydaySection(): React.JSX.Element {
  const set = useSettingsStore((s) => s.stage);
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
        title="Claude Code sessions"
        description="Jarvis watches the Claude Code sessions on this PC (read-only) and tells you out loud when one is stuck waiting for your permission. Ask “which of my Claude sessions need me?”, or have him start a new session on a project. Quiet mode silences these too."
      >
        <SettingSelect
          k="claudeCode.announce"
          label="Speak up when a session"
          options={[
            { value: 'waiting', label: 'is waiting on me' },
            { value: 'all', label: 'is waiting on me or has finished' },
            { value: 'off', label: 'Never' },
          ]}
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
