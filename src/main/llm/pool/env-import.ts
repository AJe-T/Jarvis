import { ENV_KEY_NAMES } from '@shared/free-pool';
import type { CloudProviderId } from '@shared/llm-providers';

export interface EnvKey {
  name: string;
  provider: CloudProviderId;
  value: string;
}

/** Longest key we accept; anything longer is not an API key. */
const MAX_KEY = 400;
/** API keys are printable ASCII without spaces or quotes. */
const KEY_RE = /^[\x21\x23-\x26\x28-\x7e]+$/;

/**
 * Reads provider keys out of pasted .env text (KEY=value lines, optional `export`, quotes and
 * trailing comments). Unknown names, empty values and placeholders are ignored. The values never
 * leave main and are never logged.
 */
export function parseEnvKeys(text: string): EnvKey[] {
  const out: EnvKey[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/).slice(0, 500)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1] as string;
    const provider = ENV_KEY_NAMES[name];
    if (!provider) continue;
    let value = (m[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0)
      value = value.slice(1, value.indexOf(quote, 1));
    else value = value.split(/\s+#/)[0]?.trim() ?? '';
    if (!value || value.length > MAX_KEY || !KEY_RE.test(value)) continue;
    if (/^(your|xxx|changeme|<|\.\.\.)/i.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ name, provider, value });
  }
  return out;
}
