import { isIP } from 'node:net';
import { findSensitive } from './redact';

export type GuardResult = { ok: true } | { ok: false; reason: string };

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  )
    return true;
  const v = isIP(h);
  if (v === 4) {
    const [a = 0, b = 0] = h.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (v === 6)
    return (
      h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::'
    );
  return false;
}

/** Security.md §4.2/§5: only http(s); javascript:, file:, data: etc. are blocked. Private hosts optional. */
export function urlGuard(
  raw: string,
  opts: { allowPrivate: boolean } = { allowPrivate: false },
): GuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a valid web address.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: `${url.protocol} links are not allowed; only http and https.` };
  if (url.username || url.password)
    return { ok: false, reason: 'Links with embedded credentials are not allowed.' };
  if (!opts.allowPrivate && isPrivateHost(url.hostname))
    return { ok: false, reason: 'Private network addresses are not allowed here.' };
  return { ok: true };
}

/** Security.md §4.2: never type or send passwords, OTPs, card numbers, IDs or keys. */
export function contentGuard(text: string): GuardResult {
  const found = findSensitive(text);
  return found.length === 0
    ? { ok: true }
    : { ok: false, reason: `It contains sensitive data (${found.join(', ')}).` };
}
