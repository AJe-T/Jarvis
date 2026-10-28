import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addBibleRow, bumpVersionFiles, describeShip, nextVersion, storeInstaller } from './ship';
import { parseNumstat } from './workspace';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const PKG =
  '{\n  "name": "jarvis",\n  "version": "2.37.0",\n  "files": ["a", "b"],\n  "devDependencies": { "x": "1.0.0" }\n}\n';
const LOCK = JSON.stringify(
  {
    name: 'jarvis',
    version: '2.37.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'jarvis', version: '2.37.0' },
      'node_modules/x': { version: '1.0.0' },
    },
  },
  null,
  2,
);

describe('Forge shipping (F5) helpers', () => {
  it('a fix gets a patch version, anything else a minor one', () => {
    expect(nextVersion('2.37.0', 'Add a weather card to the home page')).toBe('2.38.0');
    expect(nextVersion('2.37.4', 'Fix the orb flickering when idle')).toBe('2.37.5');
    expect(nextVersion('2.37.0', 'fix: wake word misses the name')).toBe('2.37.1');
    // "fix" later in the goal is still a feature.
    expect(nextVersion('2.37.0', 'Add dark mode and fix the toggle')).toBe('2.38.0');
    expect(() => nextVersion('2.37.0-beta', 'x')).toThrow(/unusual/);
  });

  it('sets only the package version and the lockfile root versions, keeping the formatting', () => {
    const out = bumpVersionFiles(PKG, LOCK, '2.38.0');
    expect(out.pkg).toBe(PKG.replace('"version": "2.37.0"', '"version": "2.38.0"'));
    const lock = JSON.parse(out.lock) as {
      version: string;
      packages: Record<string, { version: string }>;
    };
    expect(lock.version).toBe('2.38.0');
    expect(lock.packages['']?.version).toBe('2.38.0');
    expect(lock.packages['node_modules/x']?.version).toBe('1.0.0');
  });

  it('refuses a package.json whose first "version" is not its own', () => {
    const odd = '{\n  "engines": { "version": "1" },\n  "version": "2.37.0"\n}\n';
    expect(() => bumpVersionFiles(odd, LOCK, '2.38.0')).toThrow(/Could not set the version/);
  });

  it('adds a BIBLE row above the newest version, once', () => {
    const bible = [
      '## 11. History',
      '',
      '| Version | What arrived |',
      '|---|---|',
      '| 0.0 | Foundation |',
      '| 2.9 | Old |',
      '| 2.37 | Forge F3 |',
      '| 2.36 | Forge F1 |',
      '| 2.33.1 | A fix |',
    ].join('\n');
    const out = addBibleRow(bible, '2.38.0', 'Add a | weather\ncard') ?? '';
    const lines = out.split('\n');
    expect(lines[6]).toBe('| 2.38 | **Built by Forge:** Add a \\| weather card |');
    expect(lines[7]).toBe('| 2.37 | Forge F3 |');
    expect(addBibleRow(out, '2.38.0', 'again')).toBeNull();
    expect(addBibleRow(bible, '2.33.1', 'x')).toBeNull();
    expect(addBibleRow('no table here', '2.38.0', 'x')).toBeNull();
  });

  it('keeps the newest five installers and names the one before the new build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-inst-'));
    const src = mkdtempSync(join(tmpdir(), 'forge-dist-'));
    dirs.push(dir, src);
    for (let i = 0; i < 6; i++) {
      const f = join(dir, `Jarvis-Setup-2.3${i}.0.exe`);
      writeFileSync(f, 'x');
      utimesSync(f, 1_000_000 + i, 1_000_000 + i);
    }
    const built = join(src, 'Jarvis-Setup-2.40.0.exe');
    writeFileSync(built, 'new');
    const { installer, previous } = storeInstaller(built, dir);
    expect(installer).toBe(join(dir, 'Jarvis-Setup-2.40.0.exe'));
    expect(previous).toBe(join(dir, 'Jarvis-Setup-2.35.0.exe'));
    expect(readdirSync(dir)).toHaveLength(5);
    expect(existsSync(installer)).toBe(true);
    expect(existsSync(join(dir, 'Jarvis-Setup-2.30.0.exe'))).toBe(false);
  });

  it('reads git numstat, binary files as 0', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\tlogo.png\n0\t9\tsrc/{b.ts => c.ts}\n')).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1 },
      { path: 'logo.png', added: 0, removed: 0 },
      { path: 'src/{b.ts => c.ts}', added: 0, removed: 9 },
    ]);
  });

  it('describes each ship step for forge_status', () => {
    const text = describeShip({
      runId: 'r',
      goal: 'g',
      branch: 'forge/x',
      head: 'aaa111',
      state: 'failed',
      done: ['bumped', 'built', 'backed-up', 'merged', 'tagged'],
      merge: 'fast-forward',
      fromVersion: '2.37.0',
      version: '2.38.0',
      installer: 'C:/i/Jarvis-Setup-2.38.0.exe',
      error: 'git push: denied',
      at: 0,
    });
    expect(text).toContain('v2.38.0 (from 2.37.0): FAILED');
    expect(text).toContain('merged into dev (fast-forward)');
    expect(text).toContain('Installer: C:/i/Jarvis-Setup-2.38.0.exe');
    expect(text).toContain('Stopped: git push: denied');
    expect(text).not.toContain('pushed to GitHub');
  });
});
