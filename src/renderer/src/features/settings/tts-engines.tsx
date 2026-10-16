import {
  AURA_VOICES,
  GROQ_VOICES,
  OPENAI_TTS_MODELS,
  OPENAI_VOICES,
  PIPER_VOICES,
  TTS_ENGINES,
} from '@shared/speech-engines';
import { ELEVEN_MODELS, ELEVEN_VOICE_PRESETS, KOKORO_VOICES } from '@shared/voices';
import { Section } from '../../components/ui/field';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { EngineCards, ExternalLink } from './engine-cards';
import { SettingInput, SettingSelect, SettingTextArea } from './settings-controls';
import { EngineKey, ModelDownload, useModels } from './voice-engines';

const ESPEAK = 'https://github.com/espeak-ng/espeak-ng/releases';

function EspeakNote({ what }: { what: string }): React.JSX.Element {
  return (
    <p className="text-sm text-ink-500">
      {what} also needs the free eSpeak NG program (it turns words into sounds):{' '}
      <ExternalLink url={ESPEAK}>get eSpeak NG</ExternalLink>.
    </p>
  );
}

/** The chosen voice engine's own options (ADR-028/038). */
function VoiceEngineOptions(): React.JSX.Element | null {
  const provider = useDraftSetting('voice.tts.provider') ?? 'edge';
  const piperVoice = useDraftSetting('voice.tts.piperVoice');
  const models = useModels();
  switch (provider) {
    case 'kokoro':
      return (
        <>
          <EspeakNote what="Kokoro" />
          <ModelDownload id="kokoro-82m" models={models} />
          <SettingSelect
            k="voice.tts.kokoroVoice"
            label="Kokoro voice"
            options={KOKORO_VOICES.map((v) => ({ value: v.id, label: v.label }))}
          />
        </>
      );
    case 'piper':
      return (
        <>
          <EspeakNote what="Piper" />
          <SettingSelect
            k="voice.tts.piperVoice"
            label="Piper voice (each is its own download)"
            options={PIPER_VOICES.map((v) => ({ value: v.id, label: `${v.label} · ${v.license}` }))}
          />
          {piperVoice && <ModelDownload id={piperVoice} models={models} />}
          <p className="text-sm text-ink-500">
            Hindi and Telugu voices speak text written in that language; English replies sound best
            with an English voice.
          </p>
        </>
      );
    case 'elevenlabs':
      return (
        <>
          <SettingSelect
            k="voice.tts.elevenModel"
            label="ElevenLabs model"
            options={ELEVEN_MODELS.map((m) => ({ value: m.id, label: m.label }))}
          />
          <SettingInput
            k="voice.tts.elevenVoice"
            label="ElevenLabs voice id (a cloned voice from your library works too)"
            hint={ELEVEN_VOICE_PRESETS.map((v) => `${v.label}: ${v.id}`).join(' · ')}
          />
        </>
      );
    case 'openai':
      return (
        <>
          <SettingSelect
            k="voice.tts.openaiModel"
            label="OpenAI model"
            options={OPENAI_TTS_MODELS.map((m) => ({ value: m.id, label: m.label }))}
          />
          <SettingSelect
            k="voice.tts.openaiVoice"
            label="OpenAI voice"
            options={OPENAI_VOICES.map((v) => ({
              value: v,
              label: v[0]?.toUpperCase() + v.slice(1),
            }))}
          />
          <SettingTextArea
            k="voice.tts.openaiStyle"
            label="How it should sound (style note)"
            hint="Plain words, e.g. “calm British butler, warm and unhurried”. Only GPT-4o mini TTS follows it."
          />
        </>
      );
    case 'aura':
      return (
        <SettingSelect
          k="voice.tts.auraVoice"
          label="Aura-2 voice"
          options={AURA_VOICES.map((v) => ({ value: v.id, label: v.label }))}
        />
      );
    case 'groq':
      return (
        <SettingSelect
          k="voice.tts.groqVoice"
          label="Orpheus voice"
          options={GROQ_VOICES.map((v) => ({ value: v.id, label: v.label }))}
        />
      );
    case 'server':
      return (
        <>
          <SettingInput
            k="voice.tts.serverUrl"
            label="Server address (ending in /v1)"
            hint="Kokoro-FastAPI: http://localhost:8880/v1 · Chatterbox TTS Server: http://localhost:8004/v1 (check your server's page). Another PC on your home network works too; plain http there is unencrypted (others on the network could read it); anything outside it must be https."
          />
          <SettingInput
            k="voice.tts.serverModel"
            label="Model name on the server"
            hint="Often tts-1 (most servers accept it), or the name your server lists."
          />
          <SettingInput
            k="voice.tts.serverVoice"
            label="Voice name on the server"
            hint="A built-in voice, or the name you gave a cloned voice in the server."
          />
        </>
      );
    case 'edge':
      return (
        <SettingInput
          k="voice.tts.voice"
          label="Edge voice name"
          hint="e.g. en-GB-RyanNeural, en-GB-ThomasNeural, en-IN-PrabhatNeural, hi-IN-MadhurNeural, te-IN-MohanNeural"
        />
      );
    default:
      return null;
  }
}

/** ADR-038: every voice Jarvis can speak with, its key and its options. */
export function VoiceOutput({ name }: { name: string }): React.JSX.Element {
  const provider = useDraftSetting('voice.tts.provider') ?? 'edge';
  const set = useSettingsStore((s) => s.stage);
  const info = TTS_ENGINES.find((e) => e.id === provider);
  return (
    <Section
      title={`${name}'s voice`}
      description="How replies sound. If the chosen voice fails (no key, quota used up, server off), Jarvis switches to the Edge voice, then the Windows voice."
    >
      <EngineCards
        label="Voice engine"
        engines={TTS_ENGINES}
        value={provider}
        onChange={(id) => void set('voice.tts.provider', id)}
      />
      <EngineKey info={info} />
      <VoiceEngineOptions />
    </Section>
  );
}
