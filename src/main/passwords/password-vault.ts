import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { PasswordEntryInput as EntrySchema } from '@shared/passwords';
import { JarvisError } from '../errors';
import { newId, nowIso } from '../lib/util';

/**
 * Password manager (Security.md §16.6). A vault file encrypted with a key derived from Sir's master
 * password (scrypt → AES-256-GCM). Deliberately walled off from the AI: no tool, no context provider,
 * no memory, no logs ever see an entry. Only the Passwords view talks to it, over its own IPC channels.
 * The master password is never stored; forgetting it means the vault cannot be opened.
 */

const scrypt = (pw: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCb(pw.normalize('NFKC'), salt, 32, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

/** OWASP-recommended scrypt cost (N=2^17, r=8, p=1): ~0.3 s per unlock on a laptop. */
export const KDF = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
export const MIN_MASTER_LENGTH = 8;

export type EntryInput = z.input<typeof EntrySchema>;

export interface Entry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  totpSecret: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the list shows: never the password or the two-factor secret. */
export type EntrySummary = Omit<Entry, 'password' | 'totpSecret' | 'notes'> & {
  hasPassword: boolean;
  hasTotp: boolean;
  hasNotes: boolean;
};

const FileSchema = z.object({
  v: z.literal(1),
  kdf: z.object({ N: z.number(), r: z.number(), p: z.number(), salt: z.string() }),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});
type VaultFile = z.infer<typeof FileSchema>;

const b64 = (b: Buffer): string => b.toString('base64');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64');

function encrypt(key: Buffer, entries: Entry[], kdf: VaultFile['kdf']): VaultFile {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(entries), 'utf8'), cipher.final()]);
  return { v: 1, kdf, iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) };
}

function decrypt(key: Buffer, file: VaultFile): Entry[] {
  const decipher = createDecipheriv('aes-256-gcm', key, unb64(file.iv));
  decipher.setAuthTag(unb64(file.tag));
  const json = Buffer.concat([decipher.update(unb64(file.data)), decipher.final()]).toString(
    'utf8',
  );
  return JSON.parse(json) as Entry[];
}

// ── two-factor codes (RFC 4648 base32 + RFC 6238 TOTP, SHA-1, 6 digits, 30 s) ────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0)
      throw new JarvisError('INVALID', 'bad base32', 'That two-factor secret is not valid.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, at = Date.now(), step = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (h[h.length - 1] ?? 0) & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

// ── the vault ──────────────────────────────────────────────────────────────────────────────────
export interface VaultDeps {
  file: string;
  /** Minutes of inactivity before the vault locks itself (0 = only when Sir locks it). */
  autoLockMinutes(): number;
  onLocked?(): void;
  /** Tests use a cheap KDF. */
  kdf?: { N: number; r: number; p: number; maxmem: number };
  now?(): number;
}

export function createPasswordVault(deps: VaultDeps) {
  const kdf = deps.kdf ?? KDF;
  const now = deps.now ?? Date.now;
  let unlocked: { key: Buffer; kdf: VaultFile['kdf']; entries: Entry[] } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let blockedUntil = 0;

  function touch(): void {
    clearTimeout(idleTimer);
    const minutes = deps.autoLockMinutes();
    if (unlocked && minutes > 0) idleTimer = setTimeout(() => lock(), minutes * 60_000).unref();
  }

  function lock(): void {
    clearTimeout(idleTimer);
    if (!unlocked) return;
    unlocked.key.fill(0);
    unlocked = null;
    deps.onLocked?.();
  }

  function need(): NonNullable<typeof unlocked> {
    if (!unlocked)
      throw new JarvisError('INVALID', 'vault locked', 'The password vault is locked.');
    touch();
    return unlocked;
  }

  async function readVault(): Promise<VaultFile> {
    const parsed = FileSchema.safeParse(JSON.parse(await readFile(deps.file, 'utf8')));
    // Cost limits too: a tampered file must not make scrypt eat gigabytes of memory.
    const k = parsed.success ? parsed.data.kdf : null;
    if (!parsed.success || !k || k.N > 2 ** 20 || k.r > 16 || k.p > 4 || k.N < 2 ** 10)
      throw new JarvisError('INVALID', 'vault corrupt', 'The password vault file is damaged.');
    return parsed.data;
  }

  async function persist(u: NonNullable<typeof unlocked> = need()): Promise<void> {
    const tmp = `${deps.file}.tmp`;
    await writeFile(tmp, JSON.stringify(encrypt(u.key, u.entries, u.kdf)), { mode: 0o600 });
    await rename(tmp, deps.file);
  }

  function find(id: string): Entry {
    const e = need().entries.find((x) => x.id === id);
    if (!e) throw new JarvisError('INVALID', 'no entry', 'That entry no longer exists.');
    return e;
  }

  const summary = (e: Entry): EntrySummary => ({
    id: e.id,
    title: e.title,
    username: e.username,
    url: e.url,
    category: e.category,
    favorite: e.favorite,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    hasPassword: e.password.length > 0,
    hasTotp: e.totpSecret.length > 0,
    hasNotes: e.notes.length > 0,
  });

  return {
    status: (): { exists: boolean; unlocked: boolean; count: number } => ({
      exists: existsSync(deps.file),
      unlocked: unlocked !== null,
      count: unlocked?.entries.length ?? 0,
    }),

    /** First run: create an empty vault protected by this master password. */
    async setup(master: string): Promise<void> {
      if (existsSync(deps.file))
        throw new JarvisError('INVALID', 'vault exists', 'A password vault already exists.');
      if (master.length < MIN_MASTER_LENGTH)
        throw new JarvisError(
          'INVALID',
          'weak master',
          `Use at least ${MIN_MASTER_LENGTH} characters for the master password.`,
        );
      const salt = randomBytes(16);
      const params = { N: kdf.N, r: kdf.r, p: kdf.p, salt: b64(salt) };
      const fresh = { key: await scrypt(master, salt, kdf), kdf: params, entries: [] };
      await persist(fresh); // only "unlocked" once the file really exists
      unlocked = fresh;
      touch();
    },

    /** Wrong passwords slow down after three tries (2, 4, 8 … up to 60 s). */
    async unlock(master: string): Promise<void> {
      if (now() < blockedUntil)
        throw new JarvisError(
          'INVALID',
          'throttled',
          `Too many wrong tries. Wait ${Math.ceil((blockedUntil - now()) / 1000)} s.`,
        );
      const file = await readVault();
      const salt = unb64(file.kdf.salt);
      const key = await scrypt(master, salt, {
        N: file.kdf.N,
        r: file.kdf.r,
        p: file.kdf.p,
        maxmem: Math.max(kdf.maxmem, 128 * file.kdf.N * file.kdf.r * 2),
      });
      let entries: Entry[];
      try {
        entries = decrypt(key, file);
      } catch {
        key.fill(0);
        failures++;
        if (failures >= 3) blockedUntil = now() + Math.min(60_000, 2000 * 2 ** (failures - 3));
        throw new JarvisError('INVALID', 'wrong master', 'Wrong master password.');
      }
      failures = 0;
      unlocked = { key, kdf: file.kdf, entries };
      touch();
    },

    lock,
    touch,

    list(): EntrySummary[] {
      return need()
        .entries.map(summary)
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title));
    },

    /** The full entry for the detail/edit panel (Sir clicked it). */
    get(id: string): Entry {
      return { ...find(id) };
    },

    async save(input: EntryInput): Promise<EntrySummary> {
      const u = need();
      const e = EntrySchema.parse(input);
      const at = nowIso();
      const existing = e.id ? u.entries.find((x) => x.id === e.id) : undefined;
      const next: Entry = {
        ...e,
        id: existing?.id ?? newId('pw_'),
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      };
      u.entries = existing
        ? u.entries.map((x) => (x.id === next.id ? next : x))
        : [...u.entries, next];
      await persist();
      return summary(next);
    },

    async remove(id: string): Promise<void> {
      const u = need();
      find(id);
      u.entries = u.entries.filter((x) => x.id !== id);
      await persist();
    },

    totp(id: string): { code: string; secondsLeft: number } {
      const e = find(id);
      if (!e.totpSecret)
        throw new JarvisError('INVALID', 'no totp', 'This entry has no two-factor secret.');
      const t = now();
      return { code: totp(e.totpSecret, t), secondsLeft: 30 - (Math.floor(t / 1000) % 30) };
    },

    field(id: string, field: 'username' | 'password' | 'totp'): string {
      if (field === 'totp') return this.totp(id).code;
      return find(id)[field];
    },

    async changeMaster(current: string, next: string): Promise<void> {
      const u = need();
      if (next.length < MIN_MASTER_LENGTH)
        throw new JarvisError(
          'INVALID',
          'weak master',
          `Use at least ${MIN_MASTER_LENGTH} characters for the master password.`,
        );
      const file = await readVault();
      const check = await scrypt(current, unb64(file.kdf.salt), {
        N: file.kdf.N,
        r: file.kdf.r,
        p: file.kdf.p,
        maxmem: Math.max(kdf.maxmem, 128 * file.kdf.N * file.kdf.r * 2),
      });
      const same = check.length === u.key.length && timingSafeEqual(check, u.key);
      check.fill(0);
      if (!same) throw new JarvisError('INVALID', 'wrong master', 'Wrong master password.');
      const salt = randomBytes(16);
      u.key.fill(0);
      u.key = await scrypt(next, salt, kdf);
      u.kdf = { N: kdf.N, r: kdf.r, p: kdf.p, salt: b64(salt) };
      await persist();
    },
  };
}

export type PasswordVault = ReturnType<typeof createPasswordVault>;
