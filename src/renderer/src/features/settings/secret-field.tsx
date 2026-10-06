import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';

/** Security.md §8: shows only "•••• last4"; Replace flow; never a Reveal button. */
export function SecretField({
  name,
  label,
  placeholder,
  testable,
}: {
  name: string;
  label: string;
  placeholder?: string;
  testable?: 'anthropic' | 'deepgram' | 'picovoice';
}): React.JSX.Element {
  const status = useSettingsStore((s) => s.secrets[name]);
  const refresh = useSettingsStore((s) => s.refreshSecrets);
  const toast = useUiStore((s) => s.toast);
  const [editing, setEditing] = useState(!status?.set);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; error?: string | undefined } | null>(null);

  async function save(): Promise<void> {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await call('secrets:set', { name, value: value.trim() });
      setValue('');
      setEditing(false);
      await refresh();
      if (testable) setTest(await call('secrets:test', { name: testable }));
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-100" id={`${name}-label`}>
        {label}
      </span>
      {editing || !status?.set ? (
        <div className="flex gap-2">
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-labelledby={`${name}-label`}
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            className="flex-1 font-code"
          />
          <Button variant="primary" disabled={busy || !value.trim()} onClick={() => void save()}>
            Save key
          </Button>
          {status?.set && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="font-code text-sm text-ink-300" data-testid={`secret-${name}`}>
            •••• {status.last4}
          </span>
          <Button onClick={() => setEditing(true)}>Replace</Button>
          {testable && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void call('secrets:test', { name: testable })
                  .then(setTest)
                  .finally(() => setBusy(false));
              }}
            >
              Test
            </Button>
          )}
        </div>
      )}
      {test && (
        <p role="status" className={test.ok ? 'text-sm text-ok-400' : 'text-sm text-alarm-500'}>
          {test.ok ? '✓ Key works' : `✗ ${test.error ?? 'The key did not work.'}`}
        </p>
      )}
    </div>
  );
}
