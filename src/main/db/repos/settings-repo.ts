import { nowIso } from '../../lib/util';
import type { Db } from '../connection';

export function createSettingsRepo(db: Db) {
  return {
    all(): Map<string, unknown> {
      const rows = db.prepare('SELECT key, value_json FROM settings').all() as Array<{
        key: string;
        value_json: string;
      }>;
      return new Map(rows.map((r) => [r.key, JSON.parse(r.value_json) as unknown]));
    },
    set(key: string, value: unknown): void {
      db.prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      ).run(key, JSON.stringify(value), nowIso());
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
