import { create } from 'zustand';
import { RESTART_SETTINGS, type SettingKey, type SettingValue } from '@shared/settings';
import { call } from '../lib/api';

type Values = Partial<Record<SettingKey, unknown>>;

interface SettingsStore {
  loaded: boolean;
  values: Values;
  /** Settings view edits waiting for Save (Design-system.md §6.9); empty = nothing unsaved. */
  drafts: Values;
  secrets: Record<string, { set: boolean; last4?: string | undefined }>;
  dayCostUsd: number;
  monthCostUsd: number;
  lastModel: string | undefined;
  load(): Promise<void>;
  refreshSecrets(): Promise<void>;
  /** Saves now (onboarding, confirmed changes, main-driven flows). */
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void>;
  /** Records an edit for the Save bar; editing back to the saved value clears it. */
  stage<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void>;
  discard(): void;
  /** Saves every draft; resolves to the keys that recommend a restart. Failed keys stay as drafts. */
  saveDrafts(): Promise<{ restart: SettingKey[]; errors: string[] }>;
  setUsage(day: number, month: number, model?: string): void;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  loaded: false,
  values: {},
  drafts: {},
  secrets: {},
  dayCostUsd: 0,
  monthCostUsd: 0,
  lastModel: undefined,
  async load() {
    const [values, secrets, usage] = await Promise.all([
      call('settings:getAll', {}),
      call('secrets:status', {}),
      call('usage:summary', { range: 'day' }),
    ]);
    set({
      values: values,
      secrets,
      loaded: true,
      dayCostUsd: usage.dayCostUsd,
      monthCostUsd: usage.monthCostUsd,
    });
  },
  async refreshSecrets() {
    set({ secrets: await call('secrets:status', {}) });
  },
  async set(key, value) {
    await call('settings:set', { key, value });
    const { [key]: _, ...drafts } = get().drafts;
    set({ values: { ...get().values, [key]: value }, drafts });
  },
  stage(key, value) {
    const { [key]: _, ...rest } = get().drafts;
    set({ drafts: same(get().values[key], value) ? rest : { ...rest, [key]: value } });
    return Promise.resolve();
  },
  discard: () => set({ drafts: {} }),
  async saveDrafts() {
    const restart: SettingKey[] = [];
    const errors: string[] = [];
    for (const [key, value] of Object.entries(get().drafts) as Array<[SettingKey, unknown]>) {
      try {
        await get().set(key, value as SettingValue<typeof key>);
        if (RESTART_SETTINGS.includes(key)) restart.push(key);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return { restart, errors };
  },
  setUsage: (dayCostUsd, monthCostUsd, model) =>
    set({ dayCostUsd, monthCostUsd, ...(model ? { lastModel: model } : {}) }),
}));

/** The saved value: what Jarvis is actually using. */
export function useSetting<K extends SettingKey>(key: K): SettingValue<K> | undefined {
  return useSettingsStore((s) => s.values[key]) as SettingValue<K> | undefined;
}

/** The value Sir sees while editing: his unsaved draft, else the saved value (also live previews). */
export function useDraftSetting<K extends SettingKey>(key: K): SettingValue<K> | undefined {
  return useSettingsStore((s) => (key in s.drafts ? s.drafts[key] : s.values[key])) as
    SettingValue<K> | undefined;
}
