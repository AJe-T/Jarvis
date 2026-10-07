import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { EventPayload, Req, Res } from '@shared/ipc-contract';
import type { SettingKey, SettingValue } from '@shared/settings';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SecretField } from './secret-field';

type ModelId = Req<'models:download'>['id'];
type Status = Res<'models:status'>;
type Progress = EventPayload<'models:progress'>;

const mb = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`;

const WHISPER_MODELS: Array<{ id: ModelId; label: string; hint: string }> = [
  {
    id: 'whisper-small.en',
    label: 'small.en',
    hint: 'Recommended. Good with Indian-accented English. ~2–4 s per sentence.',
  },
  {
    id: 'whisper-base.en',
    label: 'base.en',
    hint: 'Fastest (~1 s), more mistakes on names and accents.',
  },
  {
    id: 'whisper-small',
    label: 'small (multilingual)',
    hint: 'Also Hindi, Telugu and more; slightly weaker English.',
  },
];

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
          onClick={() => void call('models:delete', { id }).then(models.refresh)}
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
  options: Array<{ value: SettingValue<K>; title: string; body: string }>;
}): React.JSX.Element {
  const value = useSetting(p.k);
  const set = useSettingsStore((s) => s.set);
  return (
    <div role="radiogroup" aria-label={p.label} className="grid gap-2 sm:grid-cols-2">
      {p.options.map((o) => (
        <button
          key={o.title}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => void set(p.k, o.value)}
          className={clsx(
            'rounded-md border p-3 text-left transition-colors',
            value === o.value
              ? 'border-reactor-500 bg-glass-inset'
              : 'border-glass-border hover:border-ink-500',
          )}
        >
          <span className="block font-semibold text-ink-100">{o.title}</span>
          <span className="mt-1 block text-sm text-ink-300">{o.body}</span>
        </button>
      ))}
    </div>
  );
}

/** ADR-011: pick cloud or on-device engines for the wake word and for speech-to-text, independently. */
export function VoiceEngines(): React.JSX.Element {
  const models = useModels();
  const wake = useSetting('voice.wake.provider') ?? 'picovoice';
  const stt = useSetting('voice.stt.provider') ?? 'deepgram';
  const whisperModel = useSetting('voice.stt.whisperModel') ?? 'whisper-small.en';
  const set = useSettingsStore((s) => s.set);
  return (
    <>
      <Section
        title="Wake word"
        description="Runs on this PC in both cases; nothing is sent anywhere until it hears you."
      >
        <Choice
          k="voice.wake.provider"
          label="Wake word engine"
          options={[
            {
              value: 'picovoice',
              title: 'Picovoice: “Jarvis”',
              body: 'Needs a free Picovoice AccessKey.',
            },
            {
              value: 'openwakeword',
              title: 'On-device: “Hey Jarvis”',
              body: 'openWakeWord, no account. Model is free for personal, non-commercial use.',
            },
          ]}
        />
        {wake === 'picovoice' ? (
          <SecretField name="picovoice" label="Picovoice AccessKey" />
        ) : (
          <ModelDownload id="openwakeword-hey-jarvis" models={models} />
        )}
      </Section>
      <Section title="Speech to text">
        <Choice
          k="voice.stt.provider"
          label="Speech-to-text engine"
          options={[
            {
              value: 'deepgram',
              title: 'Deepgram (cloud)',
              body: 'Fast and live as you speak. Audio is sent to Deepgram only while Jarvis listens. Needs a key.',
            },
            {
              value: 'whisper',
              title: 'Whisper (on this PC)',
              body: 'Private and offline. Transcribes when you stop talking, so replies start a little later.',
            },
          ]}
        />
        {stt === 'deepgram' ? (
          <SecretField name="deepgram" label="Deepgram API key" />
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink-100">Whisper model</legend>
            {WHISPER_MODELS.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-glass-border px-3 py-2"
              >
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="whisper-model"
                    className="mt-1"
                    checked={whisperModel === m.id}
                    onChange={() => void set('voice.stt.whisperModel', m.id as typeof whisperModel)}
                  />
                  <span>
                    <span className="text-ink-100">{m.label}</span>
                    <span className="block text-ink-500">{m.hint}</span>
                  </span>
                </label>
                {whisperModel === m.id && <ModelDownload id={m.id} models={models} />}
              </div>
            ))}
          </fieldset>
        )}
      </Section>
    </>
  );
}
