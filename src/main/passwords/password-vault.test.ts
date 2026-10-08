import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { base32Decode, createPasswordVault, totp } from './password-vault';

const says = (re: RegExp): Record<string, unknown> => ({
  userMessage: expect.stringMatching(re) as unknown,
});
const CHEAP = { N: 2 ** 10, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function vault(now?: () => number) {
  const file = join(mkdtempSync(join(tmpdir(), 'jarvis-pw-')), 'passwords.vault');
  let locked = 0;
  const v = createPasswordVault({
    file,
    autoLockMinutes: () => 5,
    onLocked: () => locked++,
    kdf: CHEAP,
    ...(now ? { now } : {}),
  });
  return { v, file, locked: () => locked };
}

describe('password vault', () => {
  it('encrypts entries at rest and opens only with the master password', async () => {
    const { v, file } = vault();
    await v.setup('correct horse battery');
    const saved = await v.save({ title: 'Bank', username: 'sir', password: 'S3cret!pass' });
    expect(saved).not.toHaveProperty('password');
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('S3cret!pass');
    expect(raw).not.toContain('Bank');
    v.lock();
    expect(() => v.list()).toThrow(/vault locked/);
    await expect(v.unlock('wrong password')).rejects.toMatchObject(says(/Wrong master password/));
    await v.unlock('correct horse battery');
    expect(v.list().map((e) => e.title)).toEqual(['Bank']);
    expect(v.get(saved.id).password).toBe('S3cret!pass');
  });

  it('refuses weak master passwords and a second setup', async () => {
    const { v } = vault();
    await expect(v.setup('short')).rejects.toMatchObject(says(/at least 8/));
    await v.setup('long enough pw');
    await expect(v.setup('another long one')).rejects.toMatchObject(says(/already exists/));
  });

  it('slows down repeated wrong guesses', async () => {
    let t = 1_000_000;
    const { v } = vault(() => t);
    await v.setup('correct horse battery');
    v.lock();
    for (let i = 0; i < 3; i++)
      await expect(v.unlock('nope nope')).rejects.toMatchObject(says(/Wrong/));
    await expect(v.unlock('correct horse battery')).rejects.toMatchObject(
      says(/Too many wrong tries/),
    );
    t += 61_000;
    await v.unlock('correct horse battery');
  });

  it('updates, deletes and changes the master password', async () => {
    const { v } = vault();
    await v.setup('first master pw');
    const e = await v.save({ title: 'Mail', password: 'a' });
    await v.save({ ...v.get(e.id), password: 'b' });
    expect(v.get(e.id).password).toBe('b');
    await expect(v.changeMaster('not it at all', 'second master pw')).rejects.toMatchObject(
      says(/Wrong/),
    );
    await v.changeMaster('first master pw', 'second master pw');
    v.lock();
    await v.unlock('second master pw');
    await v.remove(e.id);
    expect(v.list()).toEqual([]);
  });

  it('produces RFC 6238 two-factor codes', async () => {
    // RFC 6238 appendix B, SHA-1, secret "12345678901234567890", T = 59 s → 94287082 (8 digits).
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totp(secret, 59_000, 30, 8)).toBe('94287082');
    const { v } = vault(() => 59_000);
    await v.setup('master master');
    const e = await v.save({
      title: 'GitHub',
      totpSecret: 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq',
    });
    expect(v.list()[0]?.hasTotp).toBe(true);
    expect(v.totp(e.id)).toEqual({ code: '287082', secondsLeft: 1 });
  });
});
