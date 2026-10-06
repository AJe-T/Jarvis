import type { Db } from '../db/connection';
import { newId } from '../lib/util';

/**
 * Dictation (ideas from isair/jarvis): Sir presses the hotkey, speaks, and the words are typed into
 * whatever app is in front. Text processing and history live here; the voice controller owns the mic.
 */

const FILLERS = /(^|[\s,.!?])(?:um+|uh+|erm+|er|ah+|hmm+|mhm|uh-huh)(?=[\s,.!?]|$)[,]?/giu;

/** Drops spoken fillers ("um", "uh") and tidies the spacing and capitalisation they leave behind. */
export function removeFillers(text: string): string {
  const cleaned = text
    .replace(FILLERS, '$1')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?]){2,}/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,]+/, '')
    .trim();
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return ''; // only fillers were said
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** "heard => written" lines (also "heard -> written"); blank lines and # comments ignored. */
export function parseDictionary(src: string): Array<[RegExp, string]> {
  const out: Array<[RegExp, string]> = [];
  for (const line of src.split(/\r?\n/)) {
    const m = /^\s*([^#].*?)\s*(?:=>|->)\s*(.*?)\s*$/.exec(line);
    if (!m?.[1]) continue;
    const heard = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out.push([new RegExp(`(?<![\\p{L}\\p{N}])${heard}(?![\\p{L}\\p{N}])`, 'giu'), m[2] ?? '']);
  }
  return out;
}

export function applyDictionary(text: string, rules: Array<[RegExp, string]>): string {
  return rules.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function finishDictation(
  raw: string,
  opts: { removeFillers: boolean; dictionary: string },
): string {
  let t = raw.trim();
  if (opts.removeFillers) t = removeFillers(t);
  return applyDictionary(t, parseDictionary(opts.dictionary)).trim();
}

export interface DictationRow {
  id: string;
  ts: string;
  raw_text: string;
  final_text: string;
  target_app: string | null;
}

const KEEP = 200;

export function createDictationRepo(db: Db) {
  return {
    add(raw: string, final: string, targetApp: string | null, at = new Date()): void {
      db.prepare(
        'INSERT INTO dictations (id, ts, raw_text, final_text, target_app) VALUES (?, ?, ?, ?, ?)',
      ).run(newId('dict_'), at.toISOString(), raw, final, targetApp);
      db.prepare(
        `DELETE FROM dictations WHERE id NOT IN (SELECT id FROM dictations ORDER BY ts DESC LIMIT ${KEEP})`,
      ).run();
    },
    list(limit = 50): DictationRow[] {
      return db
        .prepare('SELECT * FROM dictations ORDER BY ts DESC LIMIT ?')
        .all(limit) as unknown as DictationRow[];
    },
    clear(): void {
      db.prepare('DELETE FROM dictations').run();
    },
  };
}

export type DictationRepo = ReturnType<typeof createDictationRepo>;
