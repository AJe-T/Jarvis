import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGit, createWorkspace } from '@main/forge/workspace';

/**
 * Forge's clone against real git: a local "GitHub" repository stands in for origin through git's
 * url.insteadOf, so the github.com-only rule stays on.
 */
const URL = 'git@github.com:sir/Jarvis.git';
let root = '';
const saved: Record<string, string | undefined> = {};

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: process.env });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'forge-git-'));
  const origin = join(root, 'origin');
  mkdirSync(origin);
  const config = join(root, 'gitconfig');
  writeFileSync(
    config,
    `[user]\n\tname = Test\n\temail = test@example.com\n[url "${origin.replace(/\\/g, '/')}"]\n\tinsteadOf = ${URL}\n[init]\n\tdefaultBranch = dev\n[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n[core]\n\tfsmonitor = false\n`,
  );
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env['GIT_CONFIG_GLOBAL'] = config;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  sh(origin, 'init', '-b', 'dev');
  writeFileSync(join(origin, 'package-lock.json'), '{"lockfileVersion":3}');
  writeFileSync(join(origin, 'CLAUDE.md'), '# rules');
  mkdirSync(join(origin, 'src'));
  writeFileSync(join(origin, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(origin, 'src', 'a.test.ts'), "it('a', () => expect(a).toBe(1));\n");
  sh(origin, 'add', '-A');
  sh(origin, 'commit', '-m', 'init');
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

describe('Forge workspace (real git)', () => {
  const ws = () => {
    const dir = join(root, 'forge', 'repo');
    mkdirSync(join(root, 'forge'), { recursive: true });
    return createWorkspace({
      dir,
      git: createGit(dir),
      run: () => Promise.resolve({ code: 0, out: '' }),
    });
  };

  it('clones, branches from origin/dev, commits and diffs the change', async () => {
    const w = ws();
    const { branch, base } = await w.prepare(URL, 'one');
    expect(branch).toBe('forge/one');
    expect(w.readText('CLAUDE.md', 100)).toBe('# rules');
    writeFileSync(join(w.dir, 'src', 'a.ts'), 'export const a = 2;\n');
    rmSync(join(w.dir, 'src', 'a.test.ts'));
    expect(await w.status()).toContain('src/a.ts');
    expect(await w.commit('feat(forge): change a')).toBe(true);
    const { files, patch, truncated } = await w.changes(base);
    expect(files).toEqual([
      { status: 'D', path: 'src/a.test.ts' },
      { status: 'M', path: 'src/a.ts' },
    ]);
    expect(patch).toContain('+export const a = 2;');
    expect(truncated).toBe(false);
    expect(await w.commit('nothing')).toBe(false);
  });

  it('never runs hooks, and cleans ignored files away before the checks', async () => {
    const w = ws();
    await w.prepare(URL, 'hooks');
    writeFileSync(
      join(w.dir, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\necho ran > hook-ran.txt\n',
    );
    writeFileSync(join(w.dir, '.git', 'info', 'exclude'), 'secret.env\n');
    writeFileSync(join(w.dir, 'secret.env'), 'TOKEN=x');
    writeFileSync(join(w.dir, 'src', 'b.ts'), 'export const b = 1;\n');
    expect(await w.commit('feat(forge): add b')).toBe(true);
    expect(w.readText('hook-ran.txt', 100)).toBe('');
    await w.clean();
    expect(w.readText('secret.env', 100)).toBe('');
    expect(w.readText('src/b.ts', 100)).toBe('export const b = 1;\n');
  });

  it('the next run starts clean from origin/dev with .git/config as cloned, node_modules kept', async () => {
    const w = ws();
    mkdirSync(join(w.dir, 'node_modules'), { recursive: true });
    writeFileSync(join(w.dir, 'node_modules', 'keep.txt'), 'kept');
    writeFileSync(join(w.dir, 'stray.txt'), 'left over');
    appendFileSync(join(w.dir, '.git', 'config'), '[forge]\n\tpoisoned = yes\n');
    await w.prepare(URL, 'two');
    expect(w.readText('stray.txt', 100)).toBe('');
    expect(w.readText('src/a.ts', 100)).toBe('export const a = 1;\n');
    expect(w.readText('node_modules/keep.txt', 100)).toBe('kept');
    expect(w.readText('.git/config', 10_000)).not.toContain('poisoned');
  });

  it('refuses a repository that is not on github.com', async () => {
    await expect(ws().prepare('https://example.com/x.git', 'three')).rejects.toThrow(/github\.com/);
  });
});
