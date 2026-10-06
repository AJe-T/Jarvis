import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';

export const newId = (prefix = ''): string => `${prefix}${nanoid()}`;
export const nowIso = (): string => new Date().toISOString();
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Local calendar day 'YYYY-MM-DD' (budgets roll over at local midnight). */
export function localDay(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

/** Stable JSON (sorted keys) for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}
