import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FORGE_REPO_RE } from '@shared/forge';
import { runProcess } from '../lib/process';
import { forgeEnv } from './env';
import type { GateCommand, GateRunner } from './gates';
import { parseNameStatus, type ChangedFile } from './protected';

/**
 * Forge's own copy of Jarvis's source (Sir's decision 2026-10-28: a separate clone only Jarvis uses,
 * so its experiments and Sir's own work never mix). One clone; each run gets a fresh branch
 * `forge/<slug>` from origin/dev and a fresh `npm ci`. Git and npm run as programs with argument
 * arrays, never through a shell.
 *
 * The checks run the changed code, which could write into `.git` or `node_modules`, so nothing there
 * is trusted from one run to the next: `.git/config` is put back to how it was after cloning, git
 * never runs hooks or an fsmonitor, and `npm ci` reinstalls every package from the lockfile.
 */

export const BASE_BRANCH = 'dev';
const MAX_PATCH = 2_000_000;
const MAX_OUT = 20_000;
const MIN = 60_000;
/**
 * On every git call: no hooks, no fsmonitor program, and plain, unquoted names in diffs whatever
 * Sir's own git settings say (quoted or unprefixed names would slip past `reviewDiff`).
 */
const SAFE_GIT = [
  '-c',
  'core.hooksPath=NUL',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.quotePath=false',
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.mnemonicPrefix=false',
  '-c',
  'diff.external=',
];
const DIFF = ['diff', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];

export type GitFn = (
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
) => Promise<string>;

export function createGit(defaultCwd: string): GitFn {
  return (args, opts = {}) =>
    new Promise((resolve, reject) => {
      execFile(
        'git',
        [...SAFE_GIT, ...args],
        {
          cwd: opts.cwd ?? defaultCwd,
          // Hidden git never waits for a password prompt; it fails and Forge says why.
          env: { ...forgeEnv(), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
          windowsHide: true,
          timeout: opts.timeoutMs ?? 2 * MIN,
          maxBuffer: MAX_PATCH * 2,
        },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`git ${args[0] ?? ''}: ${(stderr || err.message).trim()}`));
          else resolve(stdout);
        },
      );
    });
}

/** Runs npm scripts and repo scripts with Sir's node.exe (npm.cmd can't be spawned without a shell). */
export function createNodeRunner(nodeExe: string, repoDir: string): GateRunner {
  const npmCli = join(dirname(nodeExe), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return (cmd: GateCommand, opts) => {
    const args = 'npm' in cmd ? [npmCli, ...cmd.npm] : cmd.node;
    if ('npm' in cmd && !existsSync(npmCli))
      return Promise.resolve({ code: 1, out: `npm was not found next to ${nodeExe}.` });
    return runProcess(nodeExe, args, {
      cwd: repoDir,
      env: forgeEnv(),
      maxOut: MAX_OUT,
      ...opts,
    });
  };
}

export interface Workspace {
  dir: string;
  /** Clone (first time) or fetch, then a clean branch `forge/<slug>` at origin/dev. Returns its base commit. */
  prepare(repoUrl: string, slug: string): Promise<{ branch: string; base: string }>;
  /** `npm ci`: every run starts from the lockfile, never from a previous run's node_modules. */
  install(signal: AbortSignal): Promise<{ ok: boolean; out: string }>;
  /** Commits everything the boss changed; false when nothing changed. */
  commit(message: string): Promise<boolean>;
  /** Removes untracked and ignored files (.env, out/…) so the checks see only the committed change. */
  clean(): Promise<void>;
  /** `truncated`: the diff is too big to review in full, which Forge treats as a failure. */
  changes(base: string): Promise<{ files: ChangedFile[]; patch: string; truncated: boolean }>;
  /** `git status --short`: what the boss changed so far. */
  status(): Promise<string>;
  /** A text file from the repo, or '' when it doesn't exist (CLAUDE.md, RULES.md). */
  readText(rel: string, max: number): string;
}

export function createWorkspace(deps: { dir: string; git: GitFn; run: GateRunner }): Workspace {
  const { dir, git } = deps;
  const config = join(dir, '.git', 'config');
  const pristine = join(dirname(dir), 'git-config.pristine');
  return {
    dir,
    async prepare(repoUrl, slug) {
      if (!FORGE_REPO_RE.test(repoUrl))
        throw new Error('The Forge repository must be on github.com.');
      if (!existsSync(join(dir, '.git'))) {
        await git(['clone', '--branch', BASE_BRANCH, '--', repoUrl, dir], {
          cwd: dirname(dir),
          timeoutMs: 15 * MIN,
        });
        copyFileSync(config, pristine);
      } else {
        if (existsSync(pristine)) copyFileSync(pristine, config);
        if ((await git(['remote', 'get-url', 'origin'])).trim() !== repoUrl) {
          await git(['remote', 'set-url', 'origin', repoUrl]);
          copyFileSync(config, pristine);
        }
      }
      await git(['fetch', '--prune', 'origin'], { timeoutMs: 10 * MIN });
      const branch = `forge/${slug}`;
      await git(['reset', '--hard']);
      await git(['clean', '-fdx', '-e', 'node_modules']);
      await git(['checkout', '-B', branch, `origin/${BASE_BRANCH}`]);
      return { branch, base: (await git(['rev-parse', 'HEAD'])).trim() };
    },
    async install(signal) {
      const r = await deps.run({ npm: ['ci'] }, { timeoutMs: 30 * MIN, signal });
      return { ok: r.code === 0, out: r.out };
    },
    async commit(message) {
      await git(['add', '-A']);
      if ((await git(['status', '--porcelain'])).trim() === '') return false;
      await git(['commit', '-m', message]);
      return true;
    },
    async clean() {
      await git(['clean', '-fdx', '-e', 'node_modules']);
    },
    async changes(base) {
      const files = parseNameStatus(
        await git([...DIFF, '--name-status', '-M', '-z', base, 'HEAD']),
      );
      const patch = await git([...DIFF, base, 'HEAD']);
      return { files, patch: patch.slice(0, MAX_PATCH), truncated: patch.length > MAX_PATCH };
    },
    status: () => git(['status', '--short']),
    readText(rel, max) {
      const p = join(dir, rel);
      return existsSync(p) ? readFileSync(p, 'utf8').slice(0, max) : '';
    },
  };
}
