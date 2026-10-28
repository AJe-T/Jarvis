import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupNow } from '@main/db/connection';
import { shipChange, type ShipInfo } from '@main/forge/ship';
import { createGit, createWorkspace } from '@main/forge/workspace';
import type { GateRunner } from '@main/forge/gates';
import { createServices } from '@main/services';
import { createFakeClaude } from '@main/llm/fake-claude';
import { createFakeOs } from '@main/tools/native/os';
import { fakeEncryptor, setupServices } from './helpers';

/**
 * Forge phase F5 against real git: a bare "GitHub" repository stands in for origin through git's
 * url.insteadOf. Shipping bumps, commits, merges into dev, tags and pushes; a conflict stops it with
 * nothing pushed; a poisoned .git/config can't redirect the push. Rollback goes through the real
 * services wiring and the next start restores Sir's data.
 */
const URL = 'git@github.com:sir/Jarvis.git';
let root = '';
let origin = '';
const saved: Record<string, string | undefined> = {};

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Another PC pushing to dev while Forge works. */
function pushFromElsewhere(name: string, file: string, text: string): void {
  const other = join(root, name);
  sh(root, 'clone', '--branch', 'dev', origin, other);
  writeFileSync(join(other, file), text);
  sh(other, 'add', '-A');
  sh(other, 'commit', '-m', `elsewhere: ${name}`);
  sh(other, 'push', 'origin', 'dev');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'forge-ship-'));
  origin = join(root, 'origin.git');
  const config = join(root, 'gitconfig');
  writeFileSync(
    config,
    `[user]\n\tname = Test\n\temail = test@example.com\n[url "${origin.replace(/\\/g, '/')}"]\n\tinsteadOf = ${URL}\n[init]\n\tdefaultBranch = dev\n[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n[core]\n\tfsmonitor = false\n`,
  );
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env['GIT_CONFIG_GLOBAL'] = config;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  sh(root, 'init', '--bare', '-b', 'dev', origin);
  const seed = join(root, 'seed');
  sh(root, 'init', '-b', 'dev', seed);
  writeFileSync(join(seed, 'package.json'), '{\n  "name": "jarvis",\n  "version": "2.37.0"\n}\n');
  writeFileSync(
    join(seed, 'package-lock.json'),
    `${JSON.stringify({ name: 'jarvis', version: '2.37.0', lockfileVersion: 3, packages: { '': { name: 'jarvis', version: '2.37.0' } } }, null, 2)}\n`,
  );
  mkdirSync(join(seed, 'docs'));
  writeFileSync(
    join(seed, 'docs', 'BIBLE.md'),
    '| Version | What arrived |\n|---|---|\n| 2.37 | F3 |\n',
  );
  mkdirSync(join(seed, 'src'));
  writeFileSync(join(seed, 'src', 'a.ts'), 'export const a = 1;\n');
  sh(seed, 'add', '-A');
  sh(seed, 'commit', '-m', 'init');
  sh(seed, 'push', origin, 'dev');
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  // Electron's rmSync stops at git's read-only object files on Windows (EPERM); it's a temp folder.
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // left for Windows' temp cleanup
  }
});

/** npm ci passes; npm run dist writes the installer electron-builder would. */
function fakeNpm(dir: string, version: () => string, onDist?: () => void): GateRunner {
  return (cmd) => {
    if ('npm' in cmd && cmd.npm.join(' ') === 'run dist') {
      onDist?.();
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist', `Jarvis-Setup-${version()}.exe`), 'MZ');
    }
    return Promise.resolve({ code: 0, out: '' });
  };
}

async function runOnce(slug: string, edit: (dir: string) => void, onDist?: () => void) {
  const dir = join(root, 'forge', 'repo');
  mkdirSync(join(root, 'forge'), { recursive: true });
  const git = createGit(dir);
  let s: ShipInfo | null = null;
  const run = fakeNpm(dir, () => s?.version ?? '', onDist);
  const ws = createWorkspace({ dir, git, run });
  const { branch } = await ws.prepare(URL, slug);
  edit(dir);
  expect(await ws.commit(`feat(forge): ${slug}`)).toBe(true);
  const head = sh(dir, 'rev-parse', 'HEAD').trim();
  s = { runId: slug, goal: `Add ${slug}`, branch, head, state: 'running', done: [], at: 0 };
  const ship = s;
  const deps = {
    ws,
    git,
    run,
    installersDir: join(root, 'installers'),
    backup: () => join(root, 'backup.db'),
    signal: new AbortController().signal,
    onStep: () => undefined,
    onChange: () => undefined,
  };
  return { ship, deps, dir };
}

/** What the change's own tests could do with git while the checks run: an unreviewed commit. */
function evilCommit(dir: string): string {
  sh(dir, 'checkout', '-q', '-B', 'scratch');
  writeFileSync(join(dir, 'src', 'evil.ts'), `export const evil = ${Math.random()};\n`);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'unreviewed');
  const sha = sh(dir, 'rev-parse', 'HEAD').trim();
  sh(dir, 'checkout', '-q', '-');
  return sha;
}

describe('Forge shipping (real git)', { timeout: 60_000 }, () => {
  it('bumps, merges into dev, tags and pushes; the installer is kept', async () => {
    const { ship, deps } = await runOnce('one', (d) =>
      writeFileSync(join(d, 'src', 'a.ts'), 'export const a = 2;\n'),
    );
    await shipChange(deps, ship);
    expect(ship.done).toEqual(['bumped', 'built', 'backed-up', 'merged', 'tagged', 'pushed']);
    expect(ship).toMatchObject({ version: '2.38.0', merge: 'fast-forward' });
    expect(sh(origin, 'show', 'dev:package.json')).toContain('"version": "2.38.0"');
    expect(sh(origin, 'show', 'dev:package-lock.json')).toContain('"version": "2.38.0"');
    expect(sh(origin, 'show', 'dev:docs/BIBLE.md')).toContain(
      '| 2.38 | **Built by Forge:** Add one |',
    );
    expect(sh(origin, 'show', 'dev:src/a.ts')).toBe('export const a = 2;\n');
    expect(sh(origin, 'tag', '--list')).toContain('v2.38.0');
    expect(sh(origin, 'log', '-1', '--format=%s', 'dev')).toBe('chore(release): v2.38.0\n');
    expect(ship.installer).toBe(join(root, 'installers', 'Jarvis-Setup-2.38.0.exe'));
  });

  it('makes a merge commit when dev moved, and a poisoned .git/config cannot redirect the push', async () => {
    const { ship, deps, dir } = await runOnce('two', (d) =>
      writeFileSync(join(d, 'src', 'b.ts'), 'export const b = 1;\n'),
    );
    pushFromElsewhere('pc2', 'src/c.ts', 'export const c = 1;\n');
    const decoy = join(root, 'decoy.git');
    sh(root, 'init', '--bare', decoy);
    appendFileSync(
      join(dir, '.git', 'config'),
      `[remote "origin"]\n\tpushurl = ${decoy.replace(/\\/g, '/')}\n`,
    );
    await shipChange(deps, ship);
    expect(ship).toMatchObject({ version: '2.39.0', merge: 'merge commit' });
    expect(sh(origin, 'show', 'dev:src/b.ts')).toBe('export const b = 1;\n');
    expect(sh(origin, 'show', 'dev:src/c.ts')).toBe('export const c = 1;\n');
    expect(sh(origin, 'tag', '--list')).toContain('v2.39.0');
    expect(sh(decoy, 'for-each-ref')).toBe('');
    expect(ship.previousInstaller).toBe(join(root, 'installers', 'Jarvis-Setup-2.38.0.exe'));
  });

  it('a conflict stops before the tag and the push; dev on GitHub is unchanged', async () => {
    const { ship, deps } = await runOnce('three', (d) =>
      writeFileSync(join(d, 'src', 'a.ts'), 'export const a = 3;\n'),
    );
    pushFromElsewhere('pc3', 'src/a.ts', 'export const a = 99;\n');
    const before = sh(origin, 'rev-parse', 'dev');
    await expect(shipChange(deps, ship)).rejects.toThrow(/conflict/);
    expect(ship.done).toEqual(['bumped', 'built', 'backed-up']);
    expect(sh(origin, 'rev-parse', 'dev')).toBe(before);
    expect(sh(origin, 'tag', '--list')).not.toContain('v2.40.0');
  });
});

describe(
  'Forge shipping ships only what was checked (security review 2.38)',
  { timeout: 60_000 },
  () => {
    it('refuses when the branch was moved after the checks', async () => {
      const { ship, deps, dir } = await runOnce('four', (d) =>
        writeFileSync(join(d, 'src', 'd.ts'), 'export const d = 1;\n'),
      );
      sh(dir, 'update-ref', 'refs/heads/forge/four', evilCommit(dir));
      const before = sh(origin, 'rev-parse', 'dev');
      await expect(shipChange(deps, ship)).rejects.toThrow(/changed since its checks/);
      expect(sh(origin, 'rev-parse', 'dev')).toBe(before);
    });

    it('a tag or branch named like the run branch or origin/dev is never picked instead', async () => {
      const { ship, deps, dir } = await runOnce('five', (d) =>
        writeFileSync(join(d, 'src', 'e.ts'), 'export const e = 1;\n'),
      );
      const evil = evilCommit(dir);
      sh(dir, 'tag', 'forge/five', evil);
      sh(dir, 'branch', 'origin/dev', evil);
      sh(dir, 'tag', 'dev', evil);
      await shipChange(deps, ship);
      expect(sh(origin, 'show', 'dev:src/e.ts')).toBe('export const e = 1;\n');
      expect(() => sh(origin, 'show', 'dev:src/evil.ts')).toThrow();
    });

    it('npm scripts that rewrite .git/config cannot change what is fetched and merged', async () => {
      const decoy = join(root, 'decoy2.git');
      sh(root, 'clone', '-q', '--bare', origin, decoy);
      const other = join(root, 'pc-decoy');
      sh(root, 'clone', '-q', '--branch', 'dev', decoy, other);
      writeFileSync(join(other, 'src', 'decoy.ts'), 'export const decoy = 1;\n');
      sh(other, 'add', '-A');
      sh(other, 'commit', '-q', '-m', 'decoy');
      sh(other, 'push', '-q', 'origin', 'dev');
      let dir = '';
      const {
        ship,
        deps,
        dir: d0,
      } = await runOnce(
        'six',
        (d) => writeFileSync(join(d, 'src', 'f.ts'), 'export const f = 1;\n'),
        () => {
          const cfg = join(dir, '.git', 'config');
          writeFileSync(cfg, readFileSync(cfg, 'utf8').replace(URL, decoy.replace(/\\/g, '/')));
        },
      );
      dir = d0;
      await shipChange(deps, ship);
      expect(sh(origin, 'show', 'dev:src/f.ts')).toBe('export const f = 1;\n');
      expect(() => sh(origin, 'show', 'dev:src/decoy.ts')).toThrow();
    });
  },
);

describe('Forge rollback (real database)', () => {
  it("restores Sir's data from before the last Forge build on the next start", async () => {
    const { dir, services: s } = setupServices();
    const userData = join(dir, 'data');
    s.conversations.create('text');
    // What forge_approve does before Sir can install the build.
    const backup = backupNow(
      s.db,
      join(userData, 'forge', 'backups'),
      new Date('2026-10-28T08:00:00Z'),
    );
    writeFileSync(
      join(userData, 'forge', 'last-ship.json'),
      JSON.stringify({
        runId: 'r',
        goal: 'g',
        branch: 'forge/x',
        state: 'shipped',
        done: ['bumped', 'built', 'backed-up', 'merged', 'tagged', 'pushed'],
        fromVersion: '2.37.0',
        version: '2.38.0',
        // Only the file name counts: the backup must be one of Forge's own.
        backup: `C:/elsewhere/${backup.split(/[\\/]/).at(-1) ?? ''}`,
        at: 0,
      }),
    );
    s.conversations.create('text');
    expect(s.conversations.list(10)).toHaveLength(2);

    const tool = s.registry.get('forge_rollback')!;
    const out = await tool.run({}, {} as never);
    expect(out.isError).toBeUndefined();
    expect(JSON.stringify(out.content)).toContain('2. Start Jarvis');
    s.db.close();

    const after = createServices({
      userData,
      isTest: true,
      encryptor: fakeEncryptor,
      emit: () => undefined,
      llm: createFakeClaude({ rules: [] }),
      os: createFakeOs(),
      home: join(dir, 'home'),
      paths: {
        documents: dir,
        desktop: dir,
        downloads: dir,
        pictures: dir,
        videos: dir,
        music: dir,
      },
    });
    expect(after.conversations.list(10)).toHaveLength(1);
    after.db.close();
  });
});
