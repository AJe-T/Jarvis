import { useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { SettingSelect } from './settings-controls';

type Check = Res<'voice:check'>;

const box = 'max-w-xl rounded-md border border-line p-3 text-sm text-ink-100';

/** Voice v2 or classic, and what v2 uses (src/main/voice/v2/policy.ts). */
export function VoiceEngineChoice({ v2 }: { v2: boolean }): React.JSX.Element {
  const [setup, setSetup] = useState<string | null>(null);
  return (
    <Section
      title="Voice engine"
      description={
        v2
          ? 'Voice v2: one tested set of engines, nothing to tune. Microphone with echo cancellation, noise suppression and automatic volume; the on-device wake word ("Hey Jarvis", no recording of your voice needed); Deepgram for speech when its key is set (fast, accurate), otherwise speech recognition on this PC; never the old Windows recogniser.'
          : 'Classic: every engine is chosen below, as before.'
      }
    >
      <SettingSelect
        k="voice.engine"
        label="Engine"
        options={[
          { value: 'v2', label: 'Voice v2 (recommended)' },
          { value: 'classic', label: 'Classic (choose every engine yourself)' },
        ]}
      />
      {v2 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              setSetup('Downloading the free on-device models (about 80 MB, once)…');
              call('voice:setupLocal', {})
                .then(() => setSetup('Download started; Jarvis tells you when it is ready.'))
                .catch((e: unknown) => setSetup(cleanError(e)));
            }}
          >
            Set up free on-device speech
          </Button>
          {setup && <span className="text-sm text-ink-300">{setup}</span>}
        </div>
      )}
    </Section>
  );
}

/** Record one phrase and see exactly what Jarvis made of it. */
export function VoiceCheck(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await call('voice:check', {}));
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  }

  const level = result
    ? result.levelDb >= -30
      ? 'good'
      : result.levelDb >= -42
        ? 'a little quiet'
        : 'too quiet'
    : '';

  return (
    <Section
      title="Check my voice"
      description='Press the button, then say "Hey Jarvis, what time is it?" and pause. You see what was heard, whether the wake word caught it, how loud you are and how long it took.'
    >
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? 'Listening… speak now, then pause' : 'Check my voice'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-alarm-500">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className={box}>
          <p>
            Heard: <strong>{result.heard || '(nothing)'}</strong>
          </p>
          <p className="text-ink-300">
            {result.engine} · {(result.ms / 1000).toFixed(1)} s · level {result.levelDb} dB ({level}
            ) · wake word{' '}
            {result.wake === null ? 'not set up' : result.wake ? '✓ caught it' : '✗ missed it'}
          </p>
          {result.advice && <p className="mt-2 text-lamp-400">{result.advice}</p>}
        </div>
      )}
    </Section>
  );
}
