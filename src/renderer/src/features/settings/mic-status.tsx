import { useEffect, useState } from 'react';
import type { VoiceStatus } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { call } from '../../lib/api';

const box = 'max-w-xl rounded-md border border-line p-3 text-sm text-ink-100';

/**
 * Voice fix 1A: which microphone is really listening. Shows when echo cancellation's microphone
 * failed (and the retries), and when the chosen microphone wasn't found so the default one opened.
 */
export function MicStatus(): React.JSX.Element | null {
  const [st, setSt] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    void call('voice:status', {}).then(setSt);
    return window.jarvis.on('voice:status', setSt);
  }, []);
  if (!st) return null;
  const m = st.mic;
  const where = m.source === 'echo' ? 'Echo-cancelled microphone' : 'Windows microphone';

  return (
    <div role="status" className={box}>
      <p>
        <span className={m.state === 'failed' ? 'text-alarm-500' : 'text-ink-300'}>
          {m.state === 'ok'
            ? `✓ ${where}${m.device ? `: ${m.device}` : ''}`
            : m.state === 'idle'
              ? `${where} (opens when you talk)`
              : m.state === 'retrying'
                ? `Echo cancellation's microphone failed (${m.detail}). The Windows microphone is listening (no echo cancellation); trying again${m.retryInMs ? ` in ${Math.round(m.retryInMs / 1000)} s` : ''}.`
                : `Echo cancellation's microphone keeps failing (${m.detail}). The Windows microphone is listening, without echo cancellation.`}
        </span>
      </p>
      {st.hearing.engine && (
        <p className={st.hearing.why ? 'mt-2 text-lamp-400' : 'mt-2 text-ink-300'}>
          Speech recognition: {st.hearing.engine}
          {st.hearing.why ? ` (instead of ${st.hearing.chosen}: its key is missing)` : ''}
        </p>
      )}
      {st.echo !== 'off' && (
        <p className={st.echo === 'leaks' ? 'mt-2 text-lamp-400' : 'mt-2 text-ink-300'}>
          {st.echo === 'verified'
            ? '✓ Echo cancellation keeps my voice out of the microphone: saying my name interrupts me mid-reply.'
            : st.echo === 'leaks'
              ? "My voice still reaches the microphone here, so saying my name won't interrupt me while I talk (the hotkey always does). Headphones or a lower speaker volume help."
              : 'Echo cancellation is checked during my first replies; until then, interrupt me with the hotkey.'}
        </p>
      )}
      {(m.state === 'failed' || m.state === 'retrying') && (
        <Button className="mt-2" onClick={() => void call('voice:mic', { action: 'retry' })}>
          Try again
        </Button>
      )}
      {m.deviceMismatch && m.inputs.length > 0 && (
        <label className="mt-3 flex flex-col gap-1 text-lamp-400">
          The microphone you chose wasn&apos;t found by echo cancellation, so the default one is
          listening. Pick yours:
          <select
            defaultValue=""
            onChange={(e) =>
              e.target.value && void call('voice:captureDevice', { deviceId: e.target.value })
            }
            className="min-h-9 rounded-md border border-line bg-surface-2 px-2 text-base text-ink-100"
          >
            <option value="">Choose a microphone…</option>
            {m.inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Unnamed microphone'}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
