import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { SECRET_NAME_RE } from '@shared/types';
import { JarvisError } from '../errors';
import { registerSecretValue } from '../security/redact';

/** Thin seam over Electron safeStorage (DPAPI on Windows) so tests can use a fake. */
export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export interface SecretStore {
  get(name: string): string | undefined;
  set(name: string, value: string): { last4: string };
  delete(name: string): void;
  status(): Record<string, { set: boolean; last4?: string }>;
  onChange(listener: (name: string) => void): () => void;
}

/**
 * Security.md §8: secrets live encrypted in %APPDATA%/Jarvis/secrets.bin and never leave main.
 * `devFallback` (dev builds only) lets ANTHROPIC_API_KEY from .env stand in for an unset key.
 */
/** Secrets Jarvis creates for itself; Settings never shows any of their characters. */
const INTERNAL = /^(remote_|whatsapp_)/;

export function createSecretStore(
  file: string,
  enc: Encryptor,
  devFallback: Record<string, string> = {},
): SecretStore {
  let secrets: Record<string, string> = {};
  if (existsSync(file)) {
    try {
      secrets = JSON.parse(enc.decryptString(readFileSync(file))) as Record<string, string>;
    } catch {
      throw new JarvisError(
        'INTERNAL',
        'secrets.bin could not be decrypted',
        'Saved keys could not be read; please re-enter them in Settings.',
      );
    }
  }
  for (const v of [...Object.values(secrets), ...Object.values(devFallback)])
    registerSecretValue(v);
  const listeners = new Set<(name: string) => void>();

  function persist(): void {
    if (!enc.isEncryptionAvailable())
      throw new JarvisError(
        'INTERNAL',
        'safeStorage unavailable',
        'Windows encryption is unavailable, so keys cannot be saved.',
      );
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, enc.encryptString(JSON.stringify(secrets)));
    renameSync(tmp, file);
  }

  function check(name: string): void {
    if (!SECRET_NAME_RE.test(name)) throw new JarvisError('INVALID', `Bad secret name ${name}`);
  }

  return {
    get: (name) => secrets[name] ?? devFallback[name],
    set(name, value) {
      check(name);
      const trimmed = value.trim();
      secrets = { ...secrets, [name]: trimmed };
      registerSecretValue(trimmed);
      persist();
      for (const l of listeners) l(name);
      return { last4: trimmed.slice(-4) };
    },
    delete(name) {
      check(name);
      const { [name]: _removed, ...rest } = secrets;
      secrets = rest;
      persist();
      for (const l of listeners) l(name);
    },
    status() {
      const out: Record<string, { set: boolean; last4?: string }> = {};
      for (const name of new Set([...Object.keys(secrets), ...Object.keys(devFallback)])) {
        const v = secrets[name] ?? devFallback[name];
        // Internal secrets (phone remote certificate, device list, WhatsApp keys) show no characters.
        if (v) out[name] = INTERNAL.test(name) ? { set: true } : { set: true, last4: v.slice(-4) };
      }
      return out;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
