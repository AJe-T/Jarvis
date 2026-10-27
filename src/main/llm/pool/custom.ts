import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CUSTOM_ID_RE, MAX_CUSTOM_PROVIDERS, customSecret } from '@shared/free-pool';
import type { Db } from '../../db/connection';
import { JarvisError } from '../../errors';
import { isPrivateHost } from '../../security/guards';
import type { SecretStore } from '../../settings/secrets';
import { MODEL_RE } from '../connections';

/**
 * AI Router (2.31, ADR-045, Security.md §16.15): OpenAI-compatible providers Sir adds himself
 * (pollinations-style relays). Always tier 3; the address is checked when saved and again (its DNS
 * answer) before every call, and is never edited: a change is remove + add.
 */

export type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const systemLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  host: string;
  model: string;
  /** Secret name in secrets.bin (the key itself stays in main). */
  secret: string;
}

export interface CustomInput {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
}

const MAX_NAME = 40;
const MAX_URL = 200;
const invalid = (detail: string, message: string): JarvisError =>
  new JarvisError('INVALID', detail, message);
const bareHost = (u: URL): string => u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');

/** HTTPS, a public host name (no bare IP, no local names), no user name, query or fragment. */
export function checkCustomUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw invalid('bad custom url', 'That is not a valid web address.');
  }
  if (url.protocol !== 'https:')
    throw invalid('custom url not https', 'The address must start with https://.');
  if (url.username || url.password || url.search || url.hash)
    throw invalid('custom url extras', 'Use the plain API address, without a user name, ? or #.');
  const host = bareHost(url);
  if (isIP(host))
    throw invalid('custom url bare ip', "Use the provider's host name, not an IP address.");
  if (!host.includes('.') || isPrivateHost(host))
    throw invalid(
      'custom url private host',
      'Only public internet addresses are allowed, not this PC or your home network.',
    );
  const clean = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  if (clean.length > MAX_URL) throw invalid('custom url too long', 'That address is too long.');
  return clean;
}

/** Every address the host resolves to must be public. Run again before each call (DNS rebinding). */
export async function checkResolved(host: string, lookup: Lookup = systemLookup): Promise<void> {
  const all = await lookup(host).catch(() => {
    throw new JarvisError('LLM_NETWORK', `dns ${host}`, `${host} doesn't resolve.`);
  });
  if (all.length === 0 || all.some((a) => isPrivateHost(a.address)))
    throw new JarvisError(
      'POLICY_BLOCKED',
      `custom host ${host} resolves to a private address`,
      `${host} points to a private network address, so Jarvis sends nothing there.`,
    );
}

/**
 * fetch for a custom provider: the host is resolved and checked on every call, and redirects are
 * refused (one could point back at this PC). Node's fetch resolves again itself, so a host that
 * flips its DNS answer within that moment is not caught; nothing private is ever sent there anyway.
 */
export function guardedFetch(f: typeof fetch, lookup: Lookup = systemLookup): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    await checkResolved(bareHost(new URL(raw)), lookup);
    return f(input, { ...init, redirect: 'error' });
  };
}

/** Name, address and model as they will be saved; the address's host is resolved and checked. */
export async function checkCustom(
  input: CustomInput,
  lookup: Lookup = systemLookup,
): Promise<{ name: string; baseUrl: string; model: string }> {
  const name = input.name
    .replace(/[\p{Cc}]/gu, '')
    .trim()
    .slice(0, MAX_NAME);
  if (!name) throw invalid('custom name empty', 'Give the provider a name.');
  const model = input.model.trim();
  if (!MODEL_RE.test(model))
    throw invalid('bad model id', 'That model id has characters a model id never has.');
  const baseUrl = checkCustomUrl(input.baseUrl);
  await checkResolved(bareHost(new URL(baseUrl)), lookup);
  return { name, baseUrl, model };
}

interface Row {
  id: string;
  name: string;
  base_url: string;
  model: string;
}

export function createCustomProviders(deps: {
  db: Db;
  secrets: Pick<SecretStore, 'get' | 'set' | 'delete'>;
  lookup?: Lookup;
  now?: () => Date;
}) {
  const { db, secrets } = deps;
  const view = (r: Row): CustomProvider => ({
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    host: new URL(r.base_url).host,
    model: r.model,
    secret: customSecret(r.id),
  });
  const list = (): CustomProvider[] =>
    (
      db
        .prepare(
          'SELECT id, name, base_url, model FROM pool_custom WHERE removed = 0 ORDER BY created_at, id',
        )
        .all() as unknown as Row[]
    ).map(view);

  return {
    list,
    find: (id: string): CustomProvider | undefined => list().find((c) => c.id === id),

    /** Checks everything (the host's DNS answer too), then saves; the key goes straight to DPAPI. */
    async add(input: CustomInput): Promise<CustomProvider> {
      const fields = await checkCustom(input, deps.lookup);
      const all = db.prepare('SELECT id, removed FROM pool_custom').all() as Array<{
        id: string;
        removed: number;
      }>;
      if (all.filter((r) => r.removed === 0).length >= MAX_CUSTOM_PROVIDERS)
        throw invalid(
          'too many custom providers',
          `At most ${MAX_CUSTOM_PROVIDERS} of your own providers.`,
        );
      // Never reuse a number (removed rows stay), so an old key can't follow a new address.
      const n = Math.max(0, ...all.map((r) => Number(r.id.slice('custom_'.length)))) + 1;
      const id = `custom_${n}`;
      if (!CUSTOM_ID_RE.test(id))
        throw invalid('custom numbers used up', 'No more providers can be added.');
      // Key first, so a failed save never leaves a provider that silently lost its key.
      const key = input.apiKey?.trim();
      if (key) secrets.set(customSecret(id), key);
      try {
        db.prepare(
          'INSERT INTO pool_custom (id, name, base_url, model, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(
          id,
          fields.name,
          fields.baseUrl,
          fields.model,
          (deps.now?.() ?? new Date()).toISOString(),
        );
      } catch (err) {
        if (key) secrets.delete(customSecret(id));
        throw err;
      }
      return view({ id, name: fields.name, base_url: fields.baseUrl, model: fields.model });
    },

    /** The row is kept as removed (its number is never reused); the key is deleted. */
    remove(id: string): void {
      if (!CUSTOM_ID_RE.test(id))
        throw new JarvisError(
          'NOT_FOUND',
          `no custom provider ${id}`,
          'That provider does not exist.',
        );
      if (secrets.get(customSecret(id))) secrets.delete(customSecret(id));
      db.prepare('UPDATE pool_custom SET removed = 1 WHERE id = ?').run(id);
    },
  };
}

export type CustomProviders = ReturnType<typeof createCustomProviders>;
