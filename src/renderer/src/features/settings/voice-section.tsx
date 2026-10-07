import { useState } from 'react';
import type { VoiceMode } from '@shared/types';
import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { MicCheck } from '../onboarding/mic-check';
import { VoiceEngines } from './voice-engines';
import { SettingInput, SettingSelect, SettingSwitch } from './settings-controls';

const MODES: Array<{ value: VoiceMode; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Type only.' },
  {
    value: 'ptt',
    label: 'Press to talk',
    hint: 'Press the hotkey or the mic button, speak, and Jarvis stops listening when you pause.',
  },
  {
    value: 'wake',
    label: 'Wake word',
    hint: 'Listens on this PC for “Jarvis” (Picovoice) or “Hey Jarvis” (on-device); nothing leaves the PC until it hears it.',
  },
  {
    value: 'ambient',
    label: 'Always listening (on-device)',
    hint: 'Say “Jarvis” anywhere in a sentence (“…what do you think, Jarvis?”). Speech is transcribed on this PC by Whisper and kept in memory for 2 minutes only; needs on-device Whisper.',
  },
];

export function VoiceSection(): React.JSX.Element {
  const mode = useSetting('voice.mode') ?? 'off';
  const [error, setError] = useState<string | null>(null);

  async function setMode(m: VoiceMode): Promise<void> {
    const r = await call('voice:setMode', { mode: m });
    setError(r.ok ? null : (r.error ?? 'Could not change the voice mode.'));
    await useSettingsStore.getState().load();
  }

  return (
    <>
      <Section title="Voice mode">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Voice mode</legend>
          {MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="voice-mode-setting"
                className="mt-1"
                checked={mode === m.value}
                onChange={() => void setMode(m.value)}
              />
              <span>
                <span className="text-ink-100">{m.label}</span>
                <span className="block text-ink-500">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-alarm-500">
            {error}
          </p>
        )}
      </Section>
      <VoiceEngines />
      <Section title="Microphone">
        <MicCheck />
        <SettingInput
          k="voice.followUpSeconds"
          label="Follow-up window after a reply (seconds, 0 = off): keep talking without the wake word"
          type="number"
          step={1}
        />
        <SettingInput
          k="voice.endSilenceMs"
          label="Pause that ends your sentence (ms, 300–3000). Raise it if Jarvis cuts you off"
          type="number"
          step={100}
        />
        <SettingSwitch
          k="voice.quickCommands"
          label="Instant commands: routine trigger phrases, time and date are answered at once, offline"
        />
        <SettingSwitch
          k="voice.bargeIn"
          label="Wake word interrupts Jarvis while he talks (use with headphones; the hotkey always works)"
        />
        <SettingInput
          k="voice.wake.sensitivity"
          label="Wake word sensitivity (0–1, higher hears more but triggers falsely more often)"
          type="number"
          step={0.05}
        />
      </Section>
      <Section title="Speech">
        <SettingSelect
          k="voice.stt.language"
          label="Recognition language"
          options={[
            { value: 'en-IN', label: 'English (India)' },
            { value: 'en', label: 'English' },
            { value: 'en-GB', label: 'English (UK)' },
            { value: 'en-US', label: 'English (US)' },
            { value: 'hi', label: 'Hindi' },
            { value: 'te', label: 'Telugu' },
            { value: 'auto', label: 'Detect automatically (multilingual Whisper / Deepgram)' },
          ]}
        />
        <SettingSelect
          k="voice.tts.provider"
          label="Voice engine"
          options={[
            { value: 'edge', label: 'Microsoft Edge neural voices (online)' },
            { value: 'sapi', label: 'Windows voice (offline)' },
          ]}
        />
        <SettingInput
          k="voice.tts.voice"
          label="Edge voice name"
          hint="e.g. en-GB-RyanNeural, en-GB-ThomasNeural, en-IN-PrabhatNeural"
        />
        <SettingInput k="voice.tts.rate" label="Speaking rate (e.g. +5%)" />
        <SettingSwitch k="voice.sounds" label="Play chimes when listening starts and stops" />
      </Section>
    </>
  );
}
