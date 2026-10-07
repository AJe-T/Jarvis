import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useAssistantStore } from '../../stores/assistant-store';
import { useSetting } from '../../stores/settings-store';
import { saveSetting } from '../settings/settings-controls';

/** Microphone picker + live level meter (App-flow.md §3 step 4, Settings → Voice). */
export function MicCheck(): React.JSX.Element {
  const [devices, setDevices] = useState<Array<{ index: number; name: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deviceIndex = useSetting('voice.deviceIndex') ?? -1;
  const level = useAssistantStore((s) => s.micLevel);

  useEffect(() => {
    call('voice:devices', {})
      .then(setDevices)
      .catch(() => setError('Microphone list unavailable.'));
  }, []);

  if (error || (devices && devices.length === 0))
    return <p className="text-sm text-lamp-400">{error ?? 'No microphone detected.'}</p>;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Microphone">
        {(id) => (
          <select
            id={id}
            value={deviceIndex}
            onChange={(e) => void saveSetting('voice.deviceIndex', Number(e.target.value))}
            className="min-h-9 rounded-md border border-glass-border bg-glass-inset px-2 text-base text-ink-100"
          >
            <option value={-1}>System default</option>
            {(devices ?? []).map((d) => (
              <option key={d.index} value={d.index}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex items-center gap-3">
        <Button onClick={() => void call('voice:mic', { action: 'meter' })}>Test microphone</Button>
        <div
          className="h-2 flex-1 overflow-hidden rounded-pill bg-glass-selected"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, level * 4) * 100)}
        >
          <div
            className="h-full bg-reactor-500 transition-[width] duration-75"
            style={{ width: `${Math.min(1, level * 4) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
