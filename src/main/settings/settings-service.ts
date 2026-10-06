import { SETTINGS, type SettingKey, type SettingValue } from '@shared/settings';
import { JarvisError } from '../errors';
import type { SettingsRepo } from '../db/repos/settings-repo';

type Listener = (key: SettingKey, value: unknown) => void;

export interface SettingsService {
  get<K extends SettingKey>(key: K): SettingValue<K>;
  set(key: SettingKey, value: unknown): void;
  all(): Record<SettingKey, unknown>;
  onChange(listener: Listener): () => void;
}

/** Settings are validated per key (shared/settings.ts) on every write and on load. */
export function createSettingsService(repo: SettingsRepo): SettingsService {
  const values = new Map<SettingKey, unknown>();
  for (const [key, raw] of repo.all()) {
    if (!(key in SETTINGS)) continue;
    const parsed = SETTINGS[key as SettingKey].schema.safeParse(raw);
    if (parsed.success) values.set(key as SettingKey, parsed.data);
  }
  const listeners = new Set<Listener>();

  const service: SettingsService = {
    get<K extends SettingKey>(key: K): SettingValue<K> {
      return (
        values.has(key) ? values.get(key) : structuredClone(SETTINGS[key].default)
      ) as SettingValue<K>;
    },
    set(key, value) {
      const def = SETTINGS[key] as {
        schema: { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } };
      };
      const parsed = def.schema.safeParse(value);
      if (!parsed.success)
        throw new JarvisError(
          'INVALID',
          `Invalid value for ${key}`,
          `That value isn't valid for ${key}.`,
        );
      values.set(key, parsed.data);
      repo.set(key, parsed.data);
      for (const l of listeners) l(key, parsed.data);
    },
    all() {
      const out = {} as Record<SettingKey, unknown>;
      for (const key of Object.keys(SETTINGS) as SettingKey[]) out[key] = service.get(key);
      return out;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return service;
}
