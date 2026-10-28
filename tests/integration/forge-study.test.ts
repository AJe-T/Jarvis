import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forgePermission } from '@main/forge/boss';
import { addedRuns, copyFindings, indexStudyRepo } from '@main/forge/nocopy';
import { cloneStudyRepo } from '@main/forge/study';
import { createGit } from '@main/forge/workspace';

/**
 * Forge phase F6 against real git: a local "GitHub" repository stands in for
 * https://github.com/sir/sample through url.insteadOf (file:// so --depth applies). The study copy
 * is shallow, has no links, is readable but not writable by the boss, and a change copied from it
 * is caught by the no-copy check.
 */
const URL = 'https://github.com/sir/sample.git';
let root = '';
let sample = '';
const saved: Record<string, string | undefined> = {};

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const FEATURE = Array.from(
  { length: 30 },
  (_, i) => `export function step${i}(state) { return transform(state, 'phase-${i}', ${i * 7}); }`,
);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'forge-study-'));
  sample = join(root, 'sample');
  const config = join(root, 'gitconfig');
  writeFileSync(
    config,
    `[user]\n\tname = Test\n\temail = test@example.com\n[url "file:///${sample.replace(/\\/g, '/')}"]\n\tinsteadOf = ${URL}\n[init]\n\tdefaultBranch = main\n[protocol "file"]\n\tallow = always\n`,
  );
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env['GIT_CONFIG_GLOBAL'] = config;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  sh(root, 'init', '-b', 'main', sample);
  writeFileSync(join(sample, 'README.md'), '# old\n');
  sh(sample, 'add', '-A');
  sh(sample, 'commit', '-m', 'first');
  mkdirSync(join(sample, 'src'));
  writeFileSync(join(sample, 'src', 'feature.js'), FEATURE.join('\n'));
  writeFileSync(join(sample, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE\n');
  sh(sample, 'add', '-A');
  // A link to a file outside the repository, stored as a git symlink entry.
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: sample,
    input: 'C:/Windows/win.ini',
    encoding: 'utf8',
  }).trim();
  sh(sample, 'update-index', '--add', '--cacheinfo', `120000,${blob},outside-link`);
  sh(sample, 'commit', '-m', 'feature');
});

afterAll(() => {
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // git's read-only objects: left for Windows' temp cleanup
  }
});

describe('Forge study mode (real git)', { timeout: 60_000 }, () => {
  it('clones shallow and read-only, links as plain files; the boss may read it, never write it', async () => {
    const studyDir = join(root, 'forge', 'study');
    mkdirSync(studyDir, { recursive: true });
    const dir = join(studyDir, 'sir-sample');
    await cloneStudyRepo(createGit(studyDir), URL, dir);
    expect(sh(dir, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    expect(readFileSync(join(dir, 'outside-link'), 'utf8')).toBe('C:/Windows/win.ini');
    expect(existsSync(join(dir, 'src', 'feature.js'))).toBe(true);

    const repo = join(root, 'forge', 'repo');
    mkdirSync(repo, { recursive: true });
    const allow = forgePermission(repo, [], { readRoots: [dir] });
    const opts = { signal: new AbortController().signal, toolUseID: 't' } as never;
    const decide = async (name: string, input: Record<string, unknown>) =>
      (await allow(name, input, opts))?.behavior;
    expect(await decide('Read', { file_path: join(dir, 'src', 'feature.js') })).toBe('allow');
    expect(await decide('Grep', { pattern: 'step', path: dir })).toBe('allow');
    expect(await decide('Write', { file_path: join(dir, 'src', 'feature.js') })).toBe('deny');
    expect(await decide('Edit', { file_path: join(dir, 'src', 'feature.js') })).toBe('deny');
    expect(await decide('Read', { file_path: join(dir, '.git', 'config') })).toBe('deny');
    expect(await decide('mcp__rea__inspect', {})).toBe('deny');

    // Cloning again replaces the copy (a changed repository is studied fresh).
    writeFileSync(join(dir, 'stray.txt'), 'x');
    await cloneStudyRepo(createGit(studyDir), URL, dir);
    expect(existsSync(join(dir, 'stray.txt'))).toBe(false);
  });

  it('a change that copies the studied code is blocked by the no-copy check', () => {
    const dir = join(root, 'forge', 'study', 'sir-sample');
    const patch = [
      'diff --git a/src/main/copied.ts b/src/main/copied.ts',
      '--- /dev/null',
      '+++ b/src/main/copied.ts',
      '@@ -0,0 +1,24 @@',
      ...FEATURE.slice(2, 26).map((l) => `+  ${l}`),
    ].join('\n');
    const f = copyFindings(addedRuns(patch), indexStudyRepo(dir));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'block', path: 'src/main/copied.ts' });
  });
});
