import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Check, Mic } from 'lucide-react';
import { DEFAULT_NAME } from '@shared/assistant-name';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useDraftSetting, useSetting } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SettingInput, SettingSwitch } from './settings-controls';
import { ModelDownload, useModels } from './voice-engines';

type Profile = Res<'voice:profile'>;
type Step = 'idle' | 'recording' | 'saving';

/** Five dots, one per phrase. */
function Progress({ done, total }: { done: number; total: number }): React.JSX.Element {
  return (
    <ol className="flex gap-2" aria-label={`${done} of ${total} phrases recorded`}>
      {Array.from({ length: total }, (_, i) => (
        <li
          key={i}
          className={clsx(
            'grid size-7 place-items-center rounded-full border text-xs',
            i < done
              ? 'border-accent-edge bg-selected text-accent-300'
              : 'border-line text-ink-500',
          )}
        >
          {i < done ? <Check size={14} aria-hidden /> : i + 1}
        </li>
      ))}
    </ol>
  );
}

/**
 * ADR-039 Voice Match, like "Hey Google" setup: say "Hey <name>" five times. Jarvis keeps a voice
 * fingerprint (never the recordings) and how on-device speech spells the name in Sir's voice.
 */
export function VoiceProfile(): React.JSX.Element {
  const name = useDraftSetting('assistant.name') ?? DEFAULT_NAME;
  const wakeEngine = useSetting('voice.wake.provider') ?? 'spotter';
  const learned = useSetting('voice.wake.learned') ?? [];
  const toast = useUiStore((s) => s.toast);
  const models = useModels();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [heard, setHeard] = useState('');
  const [redo, setRedo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => void call('voice:profile', {}).then(setProfile), []);
  useEffect(refresh, [refresh]);
  // Leaving the page part-way drops the phrases recorded so far (main keeps only fingerprints).
  useEffect(() => () => void call('voice:enrol', { action: 'cancel' }).catch(() => undefined), []);

  const ready = !!models.status?.['wavlm-speaker']?.installed;
  const needed = profile?.needed ?? 5;
  const done = profile?.phrases ?? 0;
  const enrolling = !profile?.enrolled || redo;

  async function record(): Promise<void> {
    setError(null);
    setStep('recording');
    try {
      const r = await call('voice:enrol', { action: 'sample' });
      setHeard(r.heard ?? '');
      if ((r.count ?? 0) >= needed) {
        setStep('saving');
        const f = await call('voice:enrol', { action: 'finish' });
        setRedo(false);
        const also = f.aliases?.length
          ? ` and also hears “${f.aliases.join('”, “')}” as the name`
          : '';
        const wake =
          wakeEngine === 'spotter'
            ? f.spotterLevel
              ? ` The instant wake word is tuned to how you say “Hey ${name}”.`
              : ''
            : f.wakeWord
              ? ` Your “Hey ${name}” is now the wake word too (Wake word engine: Your own voice).`
              : '';
        toast({
          level: 'info',
          message: `Voice Match is on. ${name} now answers your voice${also}.${wake}`,
        });
      }
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setStep('idle');
      refresh();
    }
  }

  async function forget(): Promise<void> {
    await call('voice:enrol', { action: 'delete' })
      .then(() => toast({ level: 'info', message: 'Your voice profile was deleted.' }))
      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }));
    refresh();
  }

  return (
    <Section
      title="Your voice (Voice Match)"
      description={`Like setting up “Hey Google”: say “Hey ${name}” ${needed} times. ${name} learns your voice and how you say the name: your “Hey ${name}” becomes the wake word, and the wake word by name and Always listening answer only you. Press to talk always works. The recordings are never kept: only a voice fingerprint and the wake-word pattern, encrypted on this PC.`}
    >
      {!ready && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
          <span className="text-sm">
            <span className="text-ink-100">Voice recognition model (WavLM, on this PC)</span>
            <span className="block text-ink-500">One-time download; nothing is sent anywhere.</span>
          </span>
          <ModelDownload id="wavlm-speaker" models={models} />
        </div>
      )}
      {ready && enrolling && (
        <div className="flex flex-col gap-3 rounded-md border border-accent-edge bg-selected p-4">
          <Progress done={done} total={needed} />
          <p className="font-display text-lg text-ink-100" aria-live="polite">
            {step === 'saving'
              ? 'Saving your voice…'
              : step === 'recording'
                ? `Listening… say “Hey ${name}”`
                : `Press the button, then say “Hey ${name}”`}
          </p>
          <p className="text-sm text-ink-500">
            Speak normally, at your usual distance from the mic. Vary it a little: one quieter, one
            from further away.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={step !== 'idle'} onClick={() => void record()}>
              <Mic size={16} aria-hidden />
              {done === 0 ? 'Start' : `Record phrase ${Math.min(done + 1, needed)}`}
            </Button>
            {done > 0 && step === 'idle' && (
              <Button
                onClick={() =>
                  void call('voice:enrol', { action: 'cancel' }).then(() => {
                    setHeard('');
                    refresh();
                  })
                }
              >
                Start over
              </Button>
            )}
            {redo && step === 'idle' && (
              <Button onClick={() => setRedo(false)}>Keep my old voice</Button>
            )}
          </div>
          {heard && <p className="text-sm text-ink-300">Heard: “{heard}”</p>}
          {error && (
            <p role="alert" className="text-sm text-alarm-500">
              {error}
            </p>
          )}
        </div>
      )}
      {ready && !enrolling && (
        <>
          <p className="flex items-center gap-2 text-sm text-ok-400">
            <Check size={16} aria-hidden /> Your voice is set up
            {profile?.wakeTrained ? `, and your “Hey ${name}” is a wake word` : ''}.
          </p>
          {!profile?.wakeTrained && (
            <p className="text-sm text-lamp-400">
              Set up again once the “Hey Jarvis” wake-word model is downloaded (Wake word above) to
              make your own “Hey {name}” the wake word.
            </p>
          )}
          <SettingSwitch
            k="voice.speaker.verify"
            label={`Only answer to my voice (wake word by name and Always listening)`}
          />
          <SettingInput
            k="voice.speaker.threshold"
            type="number"
            step={0.01}
            label="Match strictness (0.50–0.99)"
            hint={`Set from your phrases. Raise it if ${name} answers other people or the TV; lower it if it misses you.`}
          />
          {learned.length > 0 && (
            <p className="text-sm text-ink-300">
              Also hears “{learned.join('”, “')}” as {name} (how on-device speech spelled it in your
              voice).
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setRedo(true)}>Set up again</Button>
            <Button onClick={() => void forget()}>Forget my voice</Button>
          </div>
        </>
      )}
      {wakeEngine !== 'name' && wakeEngine !== 'personal' && wakeEngine !== 'spotter' && (
        <p className="text-sm text-lamp-400">
          Voice Match checks phrases heard by the “{name}” wake word (by name) and Always listening.
          The keyword engines above don’t pass it their audio.
        </p>
      )}
      <p className="text-sm text-ink-500">
        Not a lock: a recording of your voice, or a cold, can fool or miss it. Confirmations still
        guard risky actions.
      </p>
    </Section>
  );
}
