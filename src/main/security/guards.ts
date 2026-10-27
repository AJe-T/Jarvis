import { isIP } from 'node:net';
import { findSensitive } from './redact';

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** An IPv6 address as its eight 16-bit groups (an IPv4 tail becomes two), or null. */
function ipv6Groups(h: string): number[] | null {
  let s = h.split('%')[0] ?? '';
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = s.split('::');
  const part = (x: string): string[] => (x ? x.split(':') : []);
  const fill =
    tail === undefined ? [] : Array<string>(8 - part(head).length - part(tail).length).fill('0');
  const groups = [...part(head), ...fill, ...part(tail ?? '')].map((x) => parseInt(x, 16));
  return groups.length === 8 && groups.every((n) => n >= 0 && n <= 0xffff) ? groups : null;
}

/** Loopback, private, link-local, carrier-grade NAT, multicast and local-only names (an IP or a name). */
export function isPrivateHost(host: string): boolean {
  // "localhost." is localhost: the trailing dot only says the name is complete.
  const h = host
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.home.arpa')
  )
    return true;
  const v = isIP(h);
  if (v === 4) {
    const [a = 0, b = 0] = h.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (v === 6) {
    const g = ipv6Groups(h);
    if (!g) return true;
    // An IPv4 address wrapped in IPv6 (::ffff:7f00:1 is 127.0.0.1) is judged as that IPv4.
    const [x0 = 0, x1 = 0, x2 = 0, x3 = 0, x4 = 0, x5 = 0, x6 = 0, x7 = 0] = g;
    if (x0 === 0 && x1 === 0 && x2 === 0 && x3 === 0 && x4 === 0 && x5 === 0xffff)
      return isPrivateHost(`${x6 >> 8}.${x6 & 255}.${x7 >> 8}.${x7 & 255}`);
    // Public unicast is 2000::/3 only; inside it, 6to4 (2002::/16), Teredo (2001::/32) and the
    // documentation range (2001:db8::/32) can carry or stand for any address, so they count as private.
    // Everything else (::1, ::, fc00::/7, fe80::/10, ff00::/8, NAT64 64:ff9b::/96, ::a.b.c.d…) is private.
    return (
      x0 < 0x2000 || x0 > 0x3fff || x0 === 0x2002 || (x0 === 0x2001 && (x1 === 0 || x1 === 0xdb8))
    );
  }
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
