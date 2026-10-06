import { create } from 'zustand';
import type { SettingKey, SettingValue } from '@shared/settings';
import { call } from '../lib/api';

interface SettingsStore {
  loaded: boolean;
  values: Partial<Record<SettingKey, unknown>>;
  secrets: Record<string, { set: boolean; last4?: string | undefined }>;
  dayCostUsd: number;
  monthCostUsd: number;
  lastModel: string | undefined;
  load(): Promise<void>;
  refreshSecrets(): Promise<void>;
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void>;
  setUsage(day: number, month: number, model?: string): void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  loaded: false,
  values: {},
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
    set({ values: { ...get().values, [key]: value } });
  },
  setUsage: (dayCostUsd, monthCostUsd, model) =>
    set({ dayCostUsd, monthCostUsd, ...(model ? { lastModel: model } : {}) }),
}));

export function useSetting<K extends SettingKey>(key: K): SettingValue<K> | undefined {
  return useSettingsStore((s) => s.values[key]) as SettingValue<K> | undefined;
}
