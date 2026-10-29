import { useState } from 'react';
import { DEFAULT_NAME } from '@shared/assistant-name';
import type { VoiceMode } from '@shared/types';
import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { MicCheck } from '../onboarding/mic-check';
import { LayaSection } from './laya-section';
import { MicStatus } from './mic-status';
import { VoiceCheck, VoiceEngineChoice } from './voice-v2';
import { offerRestart } from './save-bar';
import { VoiceEngines } from './voice-engines';
import { VoiceOutput } from './tts-engines';
import { VoiceProfile } from './voice-profile';
import { ModeTiles, VoiceFlow, type ModeInfo } from './voice-flow';
import { SettingInput, SettingSelect, SettingSwitch } from './settings-controls';
import { REALTIME_OPENAI_MODELS, realtimeUsdPerMinute } from '@shared/settings';

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
    {
      value: 'realtime',
      label: 'Realtime conversation (paid)',
      hint: `Say “${name}” (or press the hotkey) and just talk, like a phone call: interrupt any time, no pauses between turns. Your voice streams to OpenAI or Google for the whole conversation and their voice answers; costs per minute (below) and counts in your budget. Ends after 30 s of quiet, on “goodbye”, or the hotkey.`,
    },
  ];
}

export function VoiceSection(): React.JSX.Element {
  const mode = useDraftSetting('voice.mode') ?? 'off';
  const v2 = (useDraftSetting('voice.engine') ?? 'v2') === 'v2';
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
      <VoiceEngineChoice v2={v2} />
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
      {mode === 'realtime' && <RealtimeSettings />}
      <div id="voice-mic" className="scroll-mt-4">
        <Section
          title="Microphone"
          description="Speak and watch the bar move. No movement means Windows is using another microphone."
        >
          <MicCheck />
          <MicStatus />
        </Section>
      </div>
      <div id="voice-engines" className="scroll-mt-4">
        {v2 ? <VoiceCheck /> : <VoiceEngines />}
      </div>
      <div id="voice-output" className="scroll-mt-4">
        <VoiceOutput name={name} />
      </div>
      {!v2 && <VoiceProfile />}
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
            k="voice.capture.noiseSuppression"
            label="Noise suppression (with echo cancellation): quieter background, but it can clip the start and end of words, which makes the wake word and speech recognition miss. Turn on only in a noisy room"
          />
          <SettingSwitch
            k="voice.capture.autoGain"
            label="Automatic microphone volume (with echo cancellation): helps a very quiet microphone, but the level keeps changing, which confuses the wake word. Prefer raising the microphone level in Windows"
          />
          <p className="max-w-xl text-sm text-ink-300">
            Changed echo cancellation or these two? Record your voice again in Your voice below, so
            the wake word is calibrated for how the microphone sounds now.
          </p>
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
          <SettingSwitch
            k="voice.startupGreeting"
            label={`Greet me when ${name} starts: the time and today's plan, then listen for my answer`}
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
        <Section title="Diagnostics">
          <SettingSwitch
            k="voice.debugAudio"
            label={`Record what ${name} hears: saves the exact microphone audio given to the wake word and to speech recognition as WAV files in %APPDATA%\\Jarvis\\debug-audio (one file per wake and per request), so choppy or missing audio can be heard. Your voice, kept on this PC only; switch it off when done and the files are deleted at the next start`}
          />
        </Section>
        <LayaSection />
      </details>
    </>
  );
}

/** Voice fix 3: which realtime service, model and voice, and what a minute roughly costs. */
function RealtimeSettings(): React.JSX.Element {
  const provider = useDraftSetting('voice.realtime.provider') ?? 'openai';
  const openaiModel = useDraftSetting('voice.realtime.openaiModel') ?? 'gpt-realtime-mini';
  const geminiModel = useDraftSetting('voice.realtime.geminiModel') ?? 'gemini-3.8-live';
  const prices = useDraftSetting('voice.realtime.prices') ?? {};
  const model = provider === 'gemini' ? geminiModel : openaiModel;
  const price = prices[model];
  return (
    <Section
      title="Realtime conversation"
      description="Needs the provider's API key (Settings → AI Router → Providers). Tools still ask before anything risky (approve on screen), and the conversation is saved to your history and memory afterwards."
    >
      <SettingSelect
        k="voice.realtime.provider"
        label="Service"
        options={[
          { value: 'openai', label: 'OpenAI Realtime' },
          { value: 'gemini', label: 'Google Gemini Live' },
        ]}
      />
      {provider === 'openai' ? (
        <>
          <SettingSelect
            k="voice.realtime.openaiModel"
            label="Model"
            options={REALTIME_OPENAI_MODELS.map((m) => ({ value: m, label: m }))}
          />
          <SettingInput k="voice.realtime.openaiVoice" label="Voice (e.g. cedar, marin, ash)" />
        </>
      ) : (
        <>
          <SettingInput k="voice.realtime.geminiModel" label="Model" />
          <SettingInput k="voice.realtime.geminiVoice" label="Voice (e.g. Charon, Puck, Kore)" />
        </>
      )}
      <SettingInput
        k="voice.realtime.maxMinutes"
        label="End a conversation after this many minutes"
        type="number"
        step={1}
      />
      <p className="max-w-xl text-sm text-ink-300">
        {price
          ? `About $${realtimeUsdPerMinute(price).toFixed(3)} per minute with ${model} (an estimate from $${price.inPerMTok} / $${price.outPerMTok} per million tokens; long conversations cost more per minute). Check the provider's pricing page.`
          : `No price set for ${model}: it is counted at the dearest listed realtime price until you add one (voice.realtime.prices).`}
      </p>
    </Section>
  );
}
