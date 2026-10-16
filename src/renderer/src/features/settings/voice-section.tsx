import { useState } from 'react';
import { DEFAULT_NAME } from '@shared/assistant-name';
import type { VoiceMode } from '@shared/types';
import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { MicCheck } from '../onboarding/mic-check';
import { LayaSection } from './laya-section';
import { offerRestart } from './save-bar';
import { VoiceEngines } from './voice-engines';
import { VoiceOutput } from './tts-engines';
import { VoiceProfile } from './voice-profile';
import { ModeTiles, VoiceFlow, type ModeInfo } from './voice-flow';
import { SettingInput, SettingSelect, SettingSwitch } from './settings-controls';

/** Voice modes, worded with the assistant's name (Settings → General → Name). */
function modes(name: string): ModeInfo[] {
  return [
    { value: 'off', label: 'Off', hint: 'Type only; the microphone stays closed.' },
    {
      value: 'ptt',
      label: 'Press to talk',
      hint: `Press Ctrl+Alt+Space or the Talk button, speak, and ${name} answers when you pause. The most reliable mode.`,
    },
    {
      value: 'wake',
      label: 'Wake word',
      hint: `Say “${name}” or “Hey ${name}”, then your request (or both in one breath). Listening runs on this PC; nothing leaves it until ${name} hears the name.`,
    },
    {
      value: 'ambient',
      label: 'Always listening',
      hint: `Say “${name}” anywhere in a sentence (“…what do you think, ${name}?”) and ${name} uses the last two minutes of talk as context. Everything is transcribed on this PC and forgotten after 2 minutes; each mention costs one small model call.`,
    },
  ];
}

export function VoiceSection(): React.JSX.Element {
  const mode = useDraftSetting('voice.mode') ?? 'off';
  const name = useDraftSetting('assistant.name') ?? DEFAULT_NAME;
  const [error, setError] = useState<string | null>(null);

  async function setMode(m: VoiceMode): Promise<void> {
    const r = await call('voice:setMode', { mode: m });
    setError(r.ok ? null : (r.error ?? 'Could not change the voice mode.'));
    await useSettingsStore.getState().load();
    // A fresh start loads the wake word and microphone cleanly for the new mode.
    if (r.ok && m !== 'off') await offerRestart('voice mode');
  }

  return (
    <>
      <Section
        title="Voice mode"
        description={`How you start talking to ${name}. Not sure? Press to talk always works; Wake word is hands-free.`}
      >
        <ModeTiles modes={modes(name)} mode={mode} onPick={(m) => void setMode(m)} />
        {error && (
          <p role="alert" className="text-sm text-alarm-500">
            {error}
          </p>
        )}
      </Section>
      <Section
        title="How your voice travels"
        description="Each stage and the engine doing it. The one at work lights up while you talk; click a stage to change it."
      >
        <VoiceFlow mode={mode} />
      </Section>
      <div id="voice-mic" className="scroll-mt-4">
        <Section
          title="Microphone"
          description="Speak and watch the bar move. No movement means Windows is using another microphone."
        >
          <MicCheck />
        </Section>
      </div>
      <div id="voice-engines" className="scroll-mt-4">
        <VoiceEngines />
      </div>
      <div id="voice-output" className="scroll-mt-4">
        <VoiceOutput name={name} />
      </div>
      <VoiceProfile />
      <details className="group rounded-md border border-line bg-surface-1 open:pb-2">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-ink-100 select-none hover:bg-hover">
          <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
          Fine-tuning (the defaults suit most people)
        </summary>
        <Section title="Conversation">
          <SettingInput
            k="voice.followUpSeconds"
            label={`Follow-up window (seconds, 0 = off): after ${name} answers, keep talking without saying the name`}
            type="number"
            step={1}
          />
          <SettingInput
            k="voice.endSilenceMs"
            label={`Pause that ends your sentence (ms, 300–3000). Raise it if ${name} cuts you off; lower it for quicker replies`}
            type="number"
            step={100}
          />
          <SettingSwitch
            k="voice.echoCancel"
            label={`Echo cancellation: the microphone ignores ${name}'s own voice, so saying the name interrupts mid-reply even without headphones`}
          />
          <SettingSwitch
            k="voice.bargeIn"
            label={`Without echo cancellation, saying the name still interrupts ${name} mid-reply (use headphones, or the speakers can wake it; the hotkey always interrupts)`}
          />
          <SettingSwitch
            k="voice.quickCommands"
            label="Instant answers: time, date and routine phrases are answered at once, offline"
          />
          <SettingSwitch
            k="voice.greet"
            label={`Instant replies: “Yes, sir?” when woken and “On it, sir.” while ${name} works (no AI call). Off: say your request in the same breath as the name`}
          />
          <SettingSwitch k="voice.sounds" label="Chime when listening starts and stops" />
        </Section>
        <Section title="Language and speed">
          <SettingSelect
            k="voice.stt.language"
            label="Language you speak"
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
          <SettingInput k="voice.tts.rate" label="Speaking speed (e.g. +5% faster, -10% slower)" />
        </Section>
        <LayaSection />
      </details>
    </>
  );
}
