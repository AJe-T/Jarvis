import { useEffect, useState } from 'react';
import type { SettingKey, SettingValue } from '@shared/settings';
import { Field, Switch, TextInput } from '../../components/ui/field';
import { cleanError } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';

function asText(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** Settings controls stage their edit; the Save bar writes it (Design-system.md §6.9). */
function save<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<boolean> {
  return useSettingsStore
    .getState()
    .stage(key, value)
    .then(() => true);
}

/** Saves immediately: for changes Sir already confirmed in a dialog (folders, permissions, vault). */
async function saveNow<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<boolean> {
  try {
    await useSettingsStore.getState().set(key, value);
    return true;
  } catch (err) {
    useUiStore.getState().toast({ level: 'error', message: cleanError(err) });
    return false;
  }
}

/** Text/number setting that saves on blur or Enter. */
export function SettingInput<K extends SettingKey>({
  k,
  label,
  hint,
  type = 'text',
  step,
}: {
  k: K;
  label: string;
  hint?: string;
  type?: 'text' | 'number';
  step?: number;
}): React.JSX.Element {
  const value = useDraftSetting(k);
  const [draft, setDraft] = useState(asText(value));
  useEffect(() => setDraft(asText(value)), [value]);
  const commit = (): void => {
    if (draft === asText(value)) return;
    const v = (type === 'number' ? Number(draft) : draft) as SettingValue<K>;
    void save(k, v).then((ok) => !ok && setDraft(asText(value)));
  };
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(id) => (
        <TextInput
          id={id}
          type={type}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className={type === 'number' ? 'tabular w-40' : ''}
        />
      )}
    </Field>
  );
}

export function SettingSwitch({
  k,
  label,
}: {
  k: Extract<SettingKey, `${string}`>;
  label: string;
}): React.JSX.Element {
  const value = useDraftSetting(k) as boolean | undefined;
  return (
    <Switch
      label={label}
      checked={value === true}
      onChange={(v) => void save(k, v as SettingValue<typeof k>)}
    />
  );
}

export function SettingSelect<K extends SettingKey>({
  k,
  label,
  options,
}: {
  k: K;
  label: string;
  options: Array<{ value: string; label: string }>;
}): React.JSX.Element {
  const value = useDraftSetting(k);
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={asText(value)}
          onChange={(e) => void save(k, e.target.value as SettingValue<K>)}
          className="min-h-9 w-64 rounded-md border border-line bg-surface-2 px-2 text-base text-ink-100"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export { saveNow as saveSetting };

/** Multi-line text setting that saves on blur. */
export function SettingTextArea<K extends SettingKey>({
  k,
  label,
  hint,
  rows = 4,
}: {
  k: K;
  label: string;
  hint?: string;
  rows?: number;
}): React.JSX.Element {
  const value = useDraftSetting(k);
  const [draft, setDraft] = useState(asText(value));
  useEffect(() => setDraft(asText(value)), [value]);
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      {(id) => (
        <textarea
          id={id}
          rows={rows}
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== asText(value))
              void save(k, draft as SettingValue<K>).then((ok) => !ok && setDraft(asText(value)));
          }}
          className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-code text-sm text-ink-100"
        />
      )}
    </Field>
  );
}
