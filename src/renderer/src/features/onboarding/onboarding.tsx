import { useState } from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';
import type { VoiceMode } from '@shared/types';
import { Orb } from '../../components/jarvis/orb';
import { Button } from '../../components/ui/button';
import { Field, TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { ConnectionPicker } from '../settings/connection';
import { useModels, VoiceEngines } from '../settings/voice-engines';
import { MicCheck } from './mic-check';

const STEPS = ['Welcome', 'Brain', 'Memory vault', 'Voice', 'Safety'] as const;

function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h1 className="font-display text-2xl font-semibold text-ink-100">{children}</h1>;
}

/** App-flow.md §3: five steps, each one screen. */
export function Onboarding(): React.JSX.Element {
  const [step, setStep] = useState(0);
  const anthropic = useSettingsStore((s) => s.secrets['anthropic']);
  const secrets = useSettingsStore((s) => s.secrets);
  const defaultVault = useSetting('vault.path') ?? '';
  const roots = useSetting('files.allowedRoots') ?? [];
  const killKey = useSetting('hotkeys.kill') ?? 'Ctrl+Alt+Shift+X';
  const [vaultPath, setVaultPath] = useState(defaultVault);
  const [facts, setFacts] = useState({ role: '', project: '', city: '' });
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('off');
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.toast);
  const models = useModels();
  const sttEngine = useSetting('voice.stt.provider') ?? 'deepgram';
  const wakeEngine = useSetting('voice.wake.provider') ?? 'picovoice';
  const whisperModel = useSetting('voice.stt.whisperModel') ?? 'whisper-small.en';
  const sttReady =
    sttEngine === 'deepgram'
      ? Boolean(secrets['deepgram']?.set)
      : Boolean(models.status?.[whisperModel]?.installed);
  const wakeReady =
    wakeEngine === 'picovoice'
      ? Boolean(secrets['picovoice']?.set)
      : Boolean(models.status?.['openwakeword-hey-jarvis']?.installed);
  const voiceReady = { ptt: sttReady, wake: sttReady && wakeReady };

  async function finish(): Promise<void> {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(facts).filter(([, v]) => v.trim()));
      await call('onboarding:complete', {
        vaultPath: vaultPath || defaultVault,
        voiceMode,
        facts: clean,
      });
      await useSettingsStore.getState().load();
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    } finally {
      setBusy(false);
    }
  }

  const provider = useSetting('llm.provider') ?? 'api';
  const canNext = step !== 1 || provider === 'subscription' || Boolean(anthropic?.set);

  return (
    <main className="flex h-full flex-col items-center overflow-y-auto bg-night-900 px-6 py-10">
      <ol className="mb-10 flex items-center gap-2" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className="flex items-center gap-2"
            aria-current={i === step ? 'step' : undefined}
          >
            <span
              className={clsx(
                'flex size-7 items-center justify-center rounded-pill border text-xs',
                i < step
                  ? 'border-ok-400 text-ok-400'
                  : i === step
                    ? 'border-reactor-500 text-reactor-500'
                    : 'border-night-600 text-ink-500',
              )}
            >
              {i < step ? <Check size={14} aria-hidden /> : i + 1}
            </span>
            <span className={clsx('text-sm', i === step ? 'text-ink-100' : 'text-ink-500')}>
              {s}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-night-600" aria-hidden />}
          </li>
        ))}
      </ol>

      <section className="flex w-full max-w-xl flex-col gap-5">
        {step === 0 && (
          <>
            <div className="flex justify-center">
              <Orb state="IDLE" size="lg" />
            </div>
            <Heading>Good day, sir. I&apos;m Jarvis.</Heading>
            <p className="text-ink-300">
              I live on this PC. I can open apps, manage files, control the browser and your
              connected tools, talk with you, and remember what matters in an Obsidian vault you
              own.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-ink-300">
              <li>
                I never make payments, enter passwords or one-time codes, or change security
                settings.
              </li>
              <li>
                Anything that changes or deletes things asks you first. Some actions are blocked
                outright.
              </li>
              <li>
                Your data stays local. Conversations go to Claude to be answered; voice audio goes
                to the speech service only while I&apos;m listening.
              </li>
            </ul>
          </>
        )}

        {step === 1 && (
          <>
            <Heading>Connect my brain</Heading>
            <p className="text-ink-300">
              Choose how I reach Claude. With an API key I&apos;ll test it with a tiny request
              (default budget: $2 a day, $30 a month). With your Claude subscription I use the
              Claude Code you&apos;re signed in to on this PC.
            </p>
            <ConnectionPicker />
            <p className="text-sm text-ink-500" hidden={provider === 'subscription'}>
              Tip: also set a monthly spend limit in the{' '}
              <button
                type="button"
                className="text-reactor-500 underline"
                onClick={() =>
                  void call('app:openExternal', {
                    url: 'https://console.anthropic.com/settings/limits',
                  })
                }
              >
                Anthropic Console
              </button>
              .
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <Heading>Where should I keep my memory?</Heading>
            <p className="text-ink-300">
              I write memories and daily conversation logs as Markdown in this folder. Open it as a
              vault in Obsidian to read or edit them.
            </p>
            <Field label="Vault folder">
              {(id) => (
                <div className="flex gap-2">
                  <TextInput
                    id={id}
                    value={vaultPath || defaultVault}
                    onChange={(e) => setVaultPath(e.target.value)}
                    className="flex-1 font-code text-sm"
                  />
                  <Button
                    onClick={() =>
                      void call('app:pickFolder', {
                        title: 'Choose the JarvisBrain vault folder',
                      }).then((r) => r.path && setVaultPath(r.path))
                    }
                  >
                    Choose…
                  </Button>
                </div>
              )}
            </Field>
            <p className="text-sm text-ink-300">Optional quick facts (saved to “About Sir.md”):</p>
            <div className="grid gap-3">
              <TextInput
                aria-label="Your role"
                placeholder="Role, e.g. frontend developer"
                value={facts.role}
                onChange={(e) => setFacts({ ...facts, role: e.target.value })}
              />
              <TextInput
                aria-label="Main project"
                placeholder="Main project"
                value={facts.project}
                onChange={(e) => setFacts({ ...facts, project: e.target.value })}
              />
              <TextInput
                aria-label="City"
                placeholder="City"
                value={facts.city}
                onChange={(e) => setFacts({ ...facts, city: e.target.value })}
              />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <Heading>Voice (optional)</Heading>
            <p className="text-ink-300">
              Choose cloud services (Deepgram, Picovoice; need keys) or on-device engines (Whisper,
              openWakeWord; free downloads, nothing leaves this PC). You can skip this and type
              instead.
            </p>
            <VoiceEngines />
            <MicCheck />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink-100">Voice mode</legend>
              {(
                [
                  ['off', 'Off — type only', true],
                  ['ptt', 'Press to talk', voiceReady.ptt],
                  ['wake', 'Wake word', voiceReady.wake],
                ] as const
              ).map(([mode, label, enabled]) => (
                <label
                  key={mode}
                  className={clsx(
                    'flex items-center gap-2 text-sm',
                    enabled ? 'text-ink-100' : 'text-ink-500',
                  )}
                >
                  <input
                    type="radio"
                    name="voice-mode"
                    value={mode}
                    disabled={!enabled}
                    checked={voiceMode === mode}
                    onChange={() => setVoiceMode(mode)}
                  />
                  {label}
                  {!enabled && ' (set up the engines above first)'}
                </label>
              ))}
            </fieldset>
          </>
        )}

        {step === 4 && (
          <>
            <Heading>How I keep things safe</Heading>
            <dl className="grid gap-3 text-sm">
              <div className="rounded-md border border-night-600 p-3">
                <dt className="font-semibold text-ink-100">Safe — runs automatically</dt>
                <dd className="text-ink-300">
                  Opening apps and websites, volume, reading files in your folders, the time.
                </dd>
              </div>
              <div className="rounded-md border border-lamp-400 p-3">
                <dt className="font-semibold text-lamp-400">Confirm — asks you first</dt>
                <dd className="text-ink-300">
                  Creating, moving or deleting files (deletes go to the Recycle Bin), closing apps,
                  running PowerShell, anything that sends data.
                </dd>
              </div>
              <div className="rounded-md border border-alarm-500 p-3">
                <dt className="font-semibold text-alarm-500">Blocked — never allowed</dt>
                <dd className="text-ink-300">
                  Payments, passwords and codes, permanent deletes, security settings, admin rights.
                </dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 text-sm font-medium text-ink-100">
                Folders I may work in (change in Settings → Files & permissions):
              </p>
              <ul className="space-y-0.5 font-code text-xs text-ink-300">
                {roots.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <p className="rounded-md bg-night-800 p-3 text-sm text-ink-100">
              Press{' '}
              <kbd className="rounded-sm border border-night-600 px-1.5 font-code">{killKey}</kbd>{' '}
              at any time to stop everything I&apos;m doing.
            </p>
          </>
        )}

        <div className="mt-4 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <div className="flex gap-2">
              {step === 3 && (
                <Button variant="ghost" onClick={() => (setVoiceMode('off'), setStep(step + 1))}>
                  Skip
                </Button>
              )}
              <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
                Continue
              </Button>
            </div>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void finish()}>
              I understand
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
