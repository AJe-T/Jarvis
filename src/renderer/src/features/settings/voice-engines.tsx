import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { EventPayload, Req, Res } from '@shared/ipc-contract';
import type { SettingKey, SettingValue } from '@shared/settings';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { DEFAULT_NAME, isDefaultName } from '@shared/assistant-name';
import {
  GROQ_STT_MODELS,
  LOCAL_STT_MODELS,
  OPENAI_STT_MODELS,
  STT_ENGINES,
  type EngineInfo,
} from '@shared/speech-engines';
import { EngineCards, ExternalLink, FactChips } from './engine-cards';
import { SecretField } from './secret-field';
import { SettingInput, SettingSelect } from './settings-controls';

type ModelId = Req<'models:download'>['id'];
type Status = Res<'models:status'>;
type Progress = EventPayload<'models:progress'>;

const mb = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`;

/** models:status plus live models:progress events. */
export function useModels(): {
  status: Status | null;
  progress: Partial<Record<string, Progress>>;
  refresh(): void;
} {
  const [status, setStatus] = useState<Status | null>(null);
  const [progress, setProgress] = useState<Partial<Record<string, Progress>>>({});
  const refresh = useCallback(() => void call('models:status', {}).then(setStatus), []);
  useEffect(() => {
    refresh();
    return window.jarvis.on('models:progress', (p) => {
      setProgress((old) => ({ ...old, [p.id]: p }));
      if (p.done) refresh();
    });
  }, [refresh]);
  return { status, progress, refresh };
}

export function ModelDownload({
  id,
  models,
}: {
  id: ModelId;
  models: ReturnType<typeof useModels>;
}): React.JSX.Element | null {
  const toast = useUiStore((s) => s.toast);
  const s = models.status?.[id];
  const p = models.progress[id];
  if (!s) return null;
  if (s.installed)
    return (
      <span className="text-sm text-ok-400">
        ✓ Downloaded ({mb(s.sizeBytes)}){' '}
        <button
          type="button"
          className="ml-2 text-ink-500 underline"
          onClick={() =>
            void call('models:delete', { id })
              .then(models.refresh)
              .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
          }
        >
          Remove
        </button>
      </span>
    );
  if (s.downloading || (p && !p.done)) {
    const pct = p && p.totalBytes ? Math.round((p.receivedBytes / p.totalBytes) * 100) : 0;
    return (
      <span className="flex items-center gap-3 text-sm text-ink-300">
        <progress max={100} value={pct} aria-label={`Downloading ${id}`} className="h-2 w-40" />
        {pct}%
        <button
          type="button"
          className="underline"
          onClick={() => void call('models:cancel', { id })}
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-3">
      <Button
        onClick={() =>
          void call('models:download', { id })
            .then(models.refresh)
            .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
        }
      >
        Download ({mb(s.sizeBytes)})
      </Button>
      {p?.error && (
        <span role="alert" className="text-sm text-alarm-500">
          {p.error}
        </span>
      )}
    </span>
  );
}

function Choice<K extends SettingKey>(p: {
  k: K;
  label: string;
  options: Array<{ value: SettingValue<K>; title: string; body: string; disabled?: boolean }>;
}): React.JSX.Element {
  const value = useDraftSetting(p.k);
  const set = useSettingsStore((s) => s.stage);
  return (
    <div role="radiogroup" aria-label={p.label} className="grid gap-2 sm:grid-cols-2">
      {p.options.map((o) => (
        <button
          key={o.title}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => void set(p.k, o.value)}
          className={clsx(
            'rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
            value === o.value && !o.disabled
              ? 'border-accent-edge bg-selected'
              : 'border-line hover:border-ink-500',
          )}
        >
          <span className="block font-semibold text-ink-100">{o.title}</span>
          <span className="mt-1 block text-sm text-ink-300">{o.body}</span>
        </button>
      ))}
    </div>
  );
}

function localWhisperReady(models: ReturnType<typeof useModels>, id: string): boolean {
  return !!models.status?.[id as ModelId]?.installed;
}

/** ADR-011: pick cloud or on-device engines for the wake word and for speech-to-text, independently. */
export function VoiceEngines(): React.JSX.Element {
  const models = useModels();
  const chosen = useDraftSetting('voice.wake.provider') ?? 'spotter';
  const name = useDraftSetting('assistant.name') ?? DEFAULT_NAME;
  const custom = !isDefaultName(name);
  // The keyword models only know "Jarvis": any other name is spotted by the spotter, Whisper or Sir's own voice.
  const wake = custom && chosen !== 'personal' && chosen !== 'spotter' ? 'name' : chosen;
  const whisperModel = useDraftSetting('voice.stt.whisperModel') ?? 'whisper-small.en';
  return (
    <>
      <Section
        title="Wake word"
        description={`What starts Wake word mode. Every engine runs on this PC; nothing is sent anywhere until it hears “${name}”. Change the name in Settings → General.`}
      >
        <Choice
          k="voice.wake.provider"
          label="Wake word engine"
          options={[
            {
              value: 'spotter',
              title: `Best: instant “Hey ${name}”`,
              body: `Wakes about a third of a second after you say “Hey ${name}”${name.replace(/[^\p{L}]/gu, '').length >= 5 ? ` or just “${name}”` : ''}, for any name, with no training, using 1–2 % of the CPU. Say it all in one breath: “Hey ${name}, open Notepad”. Recording your voice (below) tunes it to your accent. Needs an 18 MB download, once.`,
            },
            {
              value: 'personal',
              title: `Your own recorded “Hey ${name}”`,
              body: `Record it five times in Your voice (below). Works for any name and any accent, on this PC. ${custom ? '' : 'The “Hey Jarvis” model listens too. '}Needs the small “Hey Jarvis” model download.`,
            },
            {
              value: 'name',
              title: `“${name}” or “Hey ${name}” by speech recognition`,
              body: `Whisper on this PC transcribes every phrase and looks for the name, so it waits for you to pause and then for Whisper: slower than the instant wake word. Uses the on-device speech models below (Moonshine or base.en is quickest).`,
            },
            {
              value: 'openwakeword',
              title: 'Keyword model: “Hey Jarvis” only',
              body: custom
                ? `Only knows “Hey Jarvis”, so it is off while the name is ${name}.`
                : 'Very light on the CPU, but answers only to “Hey Jarvis” and can miss accents. Raise the sensitivity if it does.',
              disabled: custom,
            },
            {
              value: 'picovoice',
              title: 'Picovoice: “Jarvis” only',
              body: custom
                ? `Only knows “Jarvis”, so it is off while the name is ${name}.`
                : 'Accurate keyword engine; needs a free Picovoice AccessKey.',
              disabled: custom,
            },
          ]}
        />
        {wake === 'picovoice' && <SecretField name="picovoice" label="Picovoice AccessKey" />}
        {wake === 'spotter' && (
          <>
            <ModelDownload id="kws-zipformer-en" models={models} />
            <SettingInput
              k="voice.wake.sensitivity"
              label={`Sensitivity (0–1). Higher hears “Hey ${name}” more easily but wakes by mistake more often; 0.6 suits most voices`}
              type="number"
              step={0.05}
            />
          </>
        )}
        {(wake === 'openwakeword' || wake === 'personal') && (
          <>
            <ModelDownload id="openwakeword-hey-jarvis" models={models} />
            <SettingInput
              k="voice.wake.sensitivity"
              label={`Sensitivity (0–1). Higher hears “Hey ${wake === 'personal' ? name : 'Jarvis'}” more easily but wakes by mistake more often; 0.6–0.7 suits most voices`}
              type="number"
              step={0.05}
            />
          </>
        )}
        {wake === 'name' &&
          !(
            models.status?.['silero-vad']?.installed && localWhisperReady(models, whisperModel)
          ) && (
            <p role="alert" className="text-sm text-lamp-400">
              Needs the on-device speech models: use “Set up free on-device speech” below (about 100
              MB, once).
            </p>
          )}
      </Section>
      <SpeechToText models={models} />
    </>
  );
}

/** The key an engine needs, with where to get one (ADR-038). */
export function EngineKey<Id extends string>({
  info,
}: {
  info: EngineInfo<Id> | undefined;
}): React.JSX.Element | null {
  if (!info?.key) return null;
  return (
    <div className="flex flex-col gap-1">
      <SecretField
        name={info.key}
        label={info.keyLabel ?? 'API key'}
        {...(info.key === 'deepgram' ? { testable: 'deepgram' as const } : {})}
      />
      {info.link && (
        <span className="text-sm text-ink-500">
          No key yet? <ExternalLink url={info.link}>Get one here</ExternalLink>
        </span>
      )}
    </div>
  );
}

/** The 2 MB voice detector that tells phrase engines (cloud, own server, Windows) Sir stopped talking. */
function VoiceDetector({ models }: { models: ReturnType<typeof useModels> }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
      <span className="text-sm">
        <span className="text-ink-100">Voice detector (needed)</span>
        <span className="block text-ink-500">
          Runs on this PC and hears when you stop talking, so only your phrase is sent.
        </span>
      </span>
      <ModelDownload id="silero-vad" models={models} />
    </div>
  );
}

/** On-device models: fast and small at the top, slow and accurate at the bottom. */
function LocalModels({ models }: { models: ReturnType<typeof useModels> }): React.JSX.Element {
  const chosen = useDraftSetting('voice.stt.whisperModel') ?? 'whisper-small.en';
  const set = useSettingsStore((s) => s.stage);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink-100">
        On-device model (from fastest to most accurate)
      </legend>
      {LOCAL_STT_MODELS.map((m) => {
        const size = models.status?.[m.id]?.sizeBytes;
        return (
          <div
            key={m.id}
            className={clsx(
              'flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2',
              chosen === m.id ? 'border-accent-edge bg-selected' : 'border-line',
            )}
          >
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="whisper-model"
                className="mt-1"
                checked={chosen === m.id}
                onChange={() => void set('voice.stt.whisperModel', m.id)}
              />
              <span>
                <span className="text-ink-100">{m.label}</span>
                <span className="block text-ink-500">{m.hint}</span>
                <FactChips
                  facts={{
                    speed: m.speed,
                    quality: m.accuracy,
                    languages: m.multilingual ? '99 languages' : 'English only',
                    extra: [...(size ? [mb(size)] : []), m.license],
                  }}
                />
              </span>
            </label>
            {chosen === m.id && <ModelDownload id={m.id} models={models} />}
          </div>
        );
      })}
    </fieldset>
  );
}

/** ADR-038: every speech-to-text engine, its key and its own options. */
function SpeechToText({ models }: { models: ReturnType<typeof useModels> }): React.JSX.Element {
  const stt = useDraftSetting('voice.stt.provider') ?? 'deepgram';
  const set = useSettingsStore((s) => s.stage);
  const toast = useUiStore((s) => s.toast);
  const info = STT_ENGINES.find((e) => e.id === stt);
  return (
    <Section
      title="Speech to text"
      description="What turns your voice into text. Always listening and the wake word by name always use the on-device model, whatever you pick here."
    >
      {!(
        models.status?.['silero-vad']?.installed && models.status['whisper-base.en']?.installed
      ) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-edge bg-selected px-3 py-3">
          <span className="text-sm text-ink-300">
            <span className="block font-semibold text-ink-100">
              No key? Use free on-device speech
            </span>
            One click downloads Whisper base.en and the instant wake word (about 100 MB, once).
            Private, offline, and words appear as you speak when you dictate.
          </span>
          <Button
            variant="primary"
            onClick={() =>
              void call('voice:setupLocal', {})
                .then(models.refresh)
                .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
            }
          >
            Set up free on-device speech
          </Button>
        </div>
      )}
      <EngineCards
        label="Speech-to-text engine"
        engines={STT_ENGINES}
        value={stt}
        onChange={(id) => void set('voice.stt.provider', id)}
      />
      <EngineKey info={info} />
      {stt === 'whisper' && <LocalModels models={models} />}
      {stt === 'groq' && (
        <SettingSelect
          k="voice.stt.groqModel"
          label="Groq model"
          options={GROQ_STT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
        />
      )}
      {stt === 'openai' && (
        <SettingSelect
          k="voice.stt.openaiModel"
          label="OpenAI model"
          options={OPENAI_STT_MODELS.map((m) => ({ value: m.id, label: m.label }))}
        />
      )}
      {stt === 'server' && (
        <>
          <SettingInput
            k="voice.stt.serverUrl"
            label="Server address (ending in /v1)"
            hint="Speaches (Faster-Whisper): http://localhost:8000/v1. Another PC on your home network works too (http://192.168.x.x:8000/v1); plain http there is unencrypted (others on the network could read it); anything outside it must be https."
          />
          <SettingInput
            k="voice.stt.serverModel"
            label="Model name on the server"
            hint="e.g. Systran/faster-distil-whisper-small.en for Speaches; whisper-1 if the server ignores it."
          />
        </>
      )}
      {stt !== 'whisper' && stt !== 'deepgram' && <VoiceDetector models={models} />}
    </Section>
  );
}
