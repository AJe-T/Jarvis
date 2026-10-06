import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPathGuard, defaultDeniedPaths } from './path-guard';

const base = mkdtempSync(path.join(tmpdir(), 'jarvis-pg-'));
const home = path.join(base, 'Sir');
const docs = path.join(home, 'Documents');
const desktop = path.join(home, 'Desktop');
const secret = path.join(home, 'Secret');
const appData = path.join(home, 'AppData', 'Roaming', 'Jarvis');
for (const d of [docs, desktop, secret, appData]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(docs, 'a.txt'), 'x');
writeFileSync(path.join(secret, 'keys.txt'), 'x');

const guard = createPathGuard({
  allowedRoots: () => [docs, desktop],
  deniedPaths: () => defaultDeniedPaths(home, appData),
  env: { USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming') },
  homeDir: home,
});

describe('path guard', () => {
  it('allows files inside an allowed root', () => {
    expect(guard.check(path.join(docs, 'a.txt'))).toMatchObject({ ok: true });
    expect(guard.check(path.join(docs, 'new', 'deep', 'file.md'))).toMatchObject({ ok: true });
    expect(guard.check(docs)).toMatchObject({ ok: true });
  });

  it.each([
    ['dot-dot escape', path.join(docs, '..', 'Secret', 'keys.txt')],
    ['sibling folder', secret],
    ['UNC path', '\\\\server\\share\\file.txt'],
    ['device path \\\\?\\', `\\\\?\\${docs}\\a.txt`],
    ['device path \\\\.\\', '\\\\.\\PhysicalDrive0'],
    ['forward-slash UNC', '//server/share/x'],
    ['alternate data stream', `${path.join(docs, 'a.txt')}:hidden`],
    ['case-insensitive Windows dir', 'C:\\WINDOWS\\System32\\drivers\\etc\\hosts'],
    ['Program Files', 'c:\\program files\\app\\x.exe'],
    ['trailing dot', `${path.join(docs, 'secret.txt')}.`],
    ['trailing space', `${path.join(docs, 'secret.txt')} `],
    ['relative path', 'Documents\\a.txt'],
    ['AppData via env var', '%APPDATA%\\Jarvis\\secrets.bin'],
    ['unknown env var', '%NOPE%\\x'],
    ['wildcards', path.join(docs, '*.txt')],
    ['null byte', `${path.join(docs, 'a.txt')}\u0000.png`],
    ['empty', ''],
  ])('denies %s', (_label, input) => {
    expect(guard.check(input).ok).toBe(false);
  });

  it('expands %USERPROFILE% and ~ before checking', () => {
    expect(guard.check('%USERPROFILE%\\Documents\\a.txt')).toMatchObject({ ok: true });
    expect(guard.check('~\\Desktop\\x.txt')).toMatchObject({ ok: true });
  });

  it('resolves junctions that escape an allowed root', () => {
    const link = path.join(docs, 'sneaky');
    try {
      symlinkSync(secret, link, 'junction');
    } catch {
      return; // junctions unsupported on this filesystem
    }
    expect(guard.check(path.join(link, 'keys.txt')).ok).toBe(false);
  });

  it('throws PolicyError from resolve()', () => {
    expect(() => guard.resolve('C:\\Windows\\win.ini')).toThrow(/protected location|outside/);
  });

  it('recognises an allowed root itself', () => {
    expect(guard.isRoot(guard.resolve(docs))).toBe(true);
    expect(guard.isRoot(guard.resolve(path.join(docs, 'a.txt')))).toBe(false);
  });

  // Testing.md §6.3: 1,000 random variants never resolve outside the allowed roots.
  it('fuzz: never resolves outside allowed roots', () => {
    const pieces = [
      '..',
      '.',
      'Documents',
      'Desktop',
      'Secret',
      'AppData',
      'a.txt',
      'ＳＥＣＲＥＴ',
      'x y',
      'Docu~1',
      '...',
      '%USERPROFILE%',
      '~',
    ];
    const seps = ['\\', '/', '\\\\', '/./'];
    let seed = 42;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const roots = [docs, desktop].map((r) => realpathSync.native(r).toLowerCase());
    for (let i = 0; i < 1000; i++) {
      let p = rand(3) === 0 ? home : rand(2) === 0 ? docs : desktop;
      const n = 1 + rand(6);
      for (let j = 0; j < n; j++)
        p += `${seps[rand(seps.length)] ?? ''}${pieces[rand(pieces.length)] ?? ''}`;
      if (rand(5) === 0) p = p.toUpperCase();
      const r = guard.check(p);
      if (r.ok) {
        const lowered = r.path.toLowerCase();
        expect(roots.some((root) => lowered === root || lowered.startsWith(`${root}\\`))).toBe(
          true,
        );
      }
    }
  }, 30_000);
});
