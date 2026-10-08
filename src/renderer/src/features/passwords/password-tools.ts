/** Password generator and strength estimate for the Passwords view (runs in the renderer only). */

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';

/** Unbiased index in [0, n) from the platform CSPRNG (rejection sampling). */
function randomIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] ?? 0;
    if (v < limit) return v % n;
  }
}

export interface GenOptions {
  length: number;
  symbols: boolean;
  digits: boolean;
}

/** At least one character from each chosen set, then shuffled (Fisher–Yates). */
export function generatePassword({ length, symbols, digits }: GenOptions): string {
  const sets = [LOWER, UPPER, ...(digits ? [DIGITS] : []), ...(symbols ? [SYMBOLS] : [])];
  const all = sets.join('');
  const chars = sets.map((s) => s[randomIndex(s.length)] ?? '');
  while (chars.length < length) chars.push(all[randomIndex(all.length)] ?? '');
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j] ?? '', chars[i] ?? ''];
  }
  return chars.join('');
}

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; bits: number };

/** Rough entropy: pool size from the character classes used × length, minus obvious patterns. */
export function strength(pw: string): Strength {
  if (!pw) return { score: 0, label: 'Empty', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(Math.max(pool, 1));
  if (/(.)\1{2,}/.test(pw)) bits -= 10;
  if (/^(password|qwerty|123456|letmein|admin|welcome)/i.test(pw)) bits = Math.min(bits, 10);
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  const label = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score] ?? '';
  return { score, label, bits: Math.round(bits) };
}
