import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../db/connection';
import { isPrivateHost } from '../../security/guards';
import {
  checkCustomUrl,
  checkResolved,
  createCustomProviders,
  guardedFetch,
  type Lookup,
} from './custom';

const answers =
  (...ips: string[]): Lookup =>
  async () =>
    ips.map((address) => ({ address }));

function memorySecrets() {
  const store = new Map<string, string>();
  return {
    store,
    get: (n: string) => store.get(n),
    set: (n: string, v: string) => {
      store.set(n, v);
      return { last4: v.slice(-4) };
    },
    delete: (n: string) => void store.delete(n),
  };
}

describe('custom tier-3 providers: address checks (Security.md §16.15)', () => {
  it('keeps a public HTTPS address, without the trailing slash', () => {
    expect(checkCustomUrl(' https://gen.pollinations.ai/v1/ ')).toBe(
      'https://gen.pollinations.ai/v1',
    );
  });

  it.each([
    'http://gen.pollinations.ai/v1',
    'https://127.0.0.1/v1',
    'https://2130706433/v1', // 127.0.0.1 written as one number
    'https://[::1]/v1',
    'https://8.8.8.8/v1', // any bare IP, public or not
    'https://localhost/v1',
    'https://router.local/v1',
    'https://nas.home.arpa/v1',
    'https://intranet/v1',
    'https://user:pw@relay.example.com/v1',
    'https://relay.example.com/v1?key=abc',
    'https://localhost./v1', // a trailing dot changes nothing
    'https://router.local./v1',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => checkCustomUrl(url)).toThrow();
  });

  it('refuses a host whose DNS answer is private (also IPv4 wrapped in IPv6)', async () => {
    await expect(
      checkResolved('relay.example.com', answers('104.18.1.1')),
    ).resolves.toBeUndefined();
    for (const ip of [
      '10.0.0.5',
      '192.168.1.2',
      '169.254.169.254',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      'fe90::1',
      'fd00::1',
      '::7f00:1', // IPv4-compatible
      '64:ff9b::7f00:1', // NAT64
      '2002:7f00:1::', // 6to4
      '::ffff:0:7f00:1', // SIIT
      '0:0:0:0:0:ffff:7f00:1', // written out in full
      '2001::1', // Teredo
    ])
      await expect(checkResolved('relay.example.com', answers('104.18.1.1', ip))).rejects.toThrow(
        /private/,
      );
    await expect(checkResolved('relay.example.com', answers())).rejects.toThrow();
    expect(isPrivateHost('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateHost('2606:4700::6810:101')).toBe(false);
  });

  it('re-checks DNS on every call and refuses redirects (rebinding)', async () => {
    const seen: RequestInit[] = [];
    const inner = (async (_url: string, init?: RequestInit) => {
      seen.push(init ?? {});
      return new Response('ok');
    }) as typeof fetch;
    let ip = '104.18.1.1';
    const f = guardedFetch(inner, async () => [{ address: ip }]);
    await f('https://relay.example.com/v1/chat/completions', { method: 'POST' });
    expect(seen[0]?.redirect).toBe('error');
    ip = '127.0.0.1'; // the host now points at this PC
    await expect(f('https://relay.example.com/v1/chat/completions')).rejects.toThrow(/private/);
    expect(seen).toHaveLength(1);
  });
});

describe('custom tier-3 providers: store', () => {
  function setup() {
    const db = openDatabase(':memory:');
    migrate(db);
    const secrets = memorySecrets();
    return {
      secrets,
      custom: createCustomProviders({ db, secrets, lookup: answers('104.18.1.1') }),
    };
  }
  const input = {
    name: 'Pollinations',
    baseUrl: 'https://gen.pollinations.ai/v1',
    model: 'openai',
  };

  it('saves the key in its own protected secret and never reuses a number', async () => {
    const { secrets, custom } = setup();
    const a = await custom.add({ ...input, apiKey: ' sk-abcd1234 ' });
    expect(a).toMatchObject({ id: 'custom_1', host: 'gen.pollinations.ai', secret: 'custom_ai_1' });
    expect(secrets.store.get('custom_ai_1')).toBe('sk-abcd1234');
    custom.remove(a.id);
    expect(secrets.store.has('custom_ai_1')).toBe(false);
    expect(custom.list()).toEqual([]);
    const b = await custom.add(input); // no key: fine for relays that don't want one
    expect(b.id).toBe('custom_2');
    expect(secrets.store.has('custom_ai_2')).toBe(false);
  });

  it('refuses a bad model id, an empty name, or a private address before saving', async () => {
    const { custom } = setup();
    await expect(custom.add({ ...input, model: 'gpt 4; rm' })).rejects.toThrow();
    await expect(custom.add({ ...input, name: '  ' })).rejects.toThrow();
    await expect(custom.add({ ...input, baseUrl: 'https://192.168.1.5/v1' })).rejects.toThrow();
    expect(custom.list()).toEqual([]);
  });
});
