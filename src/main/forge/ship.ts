import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { errorMessage } from '../errors';
import type { GateRunner } from './gates';
import { BASE_BRANCH, type GitFn, type Workspace } from './workspace';

/**
 * Forge phase F5 (docs/Forge.md §3 step 10): a passed change becomes a real version only after Sir
 * approves it. In Forge's clone, never Sir's folder: bump the version, add the BIBLE row, commit,
 * reinstall from the lockfile and build the installer, back up Sir's data, merge into dev, tag,
 * push. Every step is recorded, so a failed push (or merge, or build) is reported and Sir's next
 * approval resumes at that step; nothing is retried on its own. Installing stays Sir's action.
 */

export type ShipStep = 'bumped' | 'built' | 'backed-up' | 'merged' | 'tagged' | 'pushed';

export interface ShipInfo {
  runId: string;
  goal: string;
  branch: string;
  /** The commit every check passed. Only this commit (plus the version bump) is shipped. */
  head: string;
  state: 'running' | 'shipped' | 'failed' | 'cancelled';
  done: ShipStep[];
  fromVersion?: string;
  version?: string;
  /** The installer in %APPDATA%\Jarvis\forge\installers, and the newest one before it. */
  installer?: string;
  previousInstaller?: string;
  /** Sir's database (settings live in it) as it was before this build. */
  backup?: string;
  merge?: 'fast-forward' | 'merge commit';
  /** The version-bump commit on top of `head`, and what dev became after the merge. */
  release?: string;
  merged?: string;
  error?: string;
  at: number;
}

export interface ShipDeps {
  ws: Workspace;
  git: GitFn;
  run: GateRunner;
  installersDir: string;
  /** Backs up Sir's database and returns the file. */
  backup(): string;
  signal: AbortSignal;
  onStep(text: string): void;
  /** Called after every finished step, so the record survives a crash or restart. */
  onChange(): void;
}

export const KEEP_INSTALLERS = 5;
const MIN = 60_000;
const VERSION_RE = /("version"\s*:\s*")([^"]*)(")/g;
/** "Fix …", "Bug: …", "fix: …": a fix gets a patch version, everything else a minor one. */
const FIX = /^\s*(?:fix|bug|repair|hotfix)/i;

export function nextVersion(current: string, goal: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
  if (!m) throw new Error(`package.json has an unusual version "${current}".`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return FIX.test(goal) ? `${major}.${minor}.${patch + 1}` : `${major}.${minor + 1}.0`;
}

/**
 * Sets the version in package.json (its first "version") and package-lock.json (the top-level one
 * and packages[""], npm's first two), keeping each file's formatting; checked by parsing both.
 */
export function bumpVersionFiles(
  pkg: string,
  lock: string,
  to: string,
): { pkg: string; lock: string } {
  const setFirst = (text: string, count: number): string => {
    let n = 0;
    return text.replace(VERSION_RE, (all, a: string, _v: string, c: string) =>
      n++ < count ? `${a}${to}${c}` : all,
    );
  };
  const out = { pkg: setFirst(pkg, 1), lock: setFirst(lock, 2) };
  const p = JSON.parse(out.pkg) as { version?: unknown };
  const l = JSON.parse(out.lock) as { version?: unknown; packages?: Record<string, unknown> };
  const root = l.packages?.[''] as { version?: unknown } | undefined;
  if (p.version !== to || l.version !== to || root?.version !== to)
    throw new Error('Could not set the version in package.json and package-lock.json.');
  return out;
}

const versionKey = (v: string): number[] => v.split('.').map(Number);
const newer = (a: string, b: string): boolean => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/**
 * docs/BIBLE.md §11 gets a row for the new version when the boss didn't add one: right above the
 * newest version's row. Null when the row exists or there is no history table.
 */
export function addBibleRow(bible: string, version: string, goal: string): string | null {
  const label = version.replace(/\.0$/, '');
  const lines = bible.split('\n');
  if (!lines.some((l) => /^\|\s*Version\s*\|\s*What arrived\s*\|/.test(l))) return null;
  const rowVersion = (l: string): string | null =>
    /^\|\s*(\d+\.\d+(?:\.\d+)?)\s*\|/.exec(l)?.[1] ?? null;
  if (lines.some((l) => rowVersion(l) === label)) return null;
  let at = -1;
  let best = '';
  lines.forEach((l, i) => {
    const v = rowVersion(l);
    if (v && (at < 0 || newer(v, best))) [at, best] = [i, v];
  });
  if (at < 0) return null;
  const what = goal.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim().slice(0, 300);
  lines.splice(at, 0, `| ${label} | **Built by Forge:** ${what} |`);
  return lines.join('\n');
}

function installers(dir: string): Array<{ path: string; at: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^Jarvis-Setup-.+\.exe$/i.test(f))
    .map((f) => ({ path: join(dir, f), at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
}

/** Copies the new installer in and keeps the newest five; returns the newest one before it. */
export function storeInstaller(
  source: string,
  dir: string,
  keep = KEEP_INSTALLERS,
): { installer: string; previous: string | null } {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, basename(source));
  const previous = installers(dir).find((i) => i.path !== target)?.path ?? null;
  copyFileSync(source, target);
  for (const old of installers(dir)
    .filter((i) => i.path !== target)
    .slice(keep - 1))
    rmSync(old.path, { force: true });
  return { installer: target, previous };
}

async function bump(d: ShipDeps, s: ShipInfo): Promise<void> {
  const read = (rel: string): string => readFileSync(join(d.ws.dir, rel), 'utf8');
  const pkg = read('package.json');
  const from = (JSON.parse(pkg) as { version?: unknown }).version;
  if (typeof from !== 'string') throw new Error('package.json has no version.');
  const version = nextVersion(from, s.goal);
  const files = bumpVersionFiles(pkg, read('package-lock.json'), version);
  writeFileSync(join(d.ws.dir, 'package.json'), files.pkg, 'utf8');
  writeFileSync(join(d.ws.dir, 'package-lock.json'), files.lock, 'utf8');
  const changed = ['package.json', 'package-lock.json'];
  const bible = d.ws.readText('docs/BIBLE.md', 5_000_000);
  const withRow = bible ? addBibleRow(bible, version, s.goal) : null;
  if (withRow) {
    writeFileSync(join(d.ws.dir, 'docs', 'BIBLE.md'), withRow, 'utf8');
    changed.push('docs/BIBLE.md');
  }
  await d.git(['add', '--', ...changed]);
  await d.git([
    'commit',
    '-m',
    `chore(release): v${version}\n\nShipped by Jarvis Forge after Sir approved run ${s.runId}.`,
  ]);
  Object.assign(s, { fromVersion: from, version, release: await sha(d, 'HEAD') });
}

/** A commit id, never a short name: a tag or branch called "dev" or "origin/dev" can't stand in. */
async function sha(d: ShipDeps, ref: string): Promise<string> {
  return (await d.git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}

async function npm(d: ShipDeps, args: string[], what: string, timeoutMs: number): Promise<void> {
  d.onStep(what);
  const r = await d.run({ npm: args }, { timeoutMs, signal: d.signal });
  if (d.signal.aborted) throw new Error('Shipping was cancelled.');
  if (r.code !== 0) throw new Error(`npm ${args.join(' ')} failed:\n${r.out.slice(-2000)}`);
}

/**
 * The checks ran the change's own code, which can move refs and edit the index or files. The run's
 * branch must still be the commit they passed (or its version bump), and the tree must be exactly
 * that commit before anything is built from it.
 */
async function checkoutReviewed(d: ShipDeps, s: ShipInfo): Promise<void> {
  const expected = s.done.includes('bumped') ? (s.release ?? '') : s.head;
  const tip = await sha(d, `refs/heads/${s.branch}`);
  if (!expected || tip !== expected)
    throw new Error(
      `The branch ${s.branch} changed since its checks (${tip.slice(0, 8)} instead of ${expected.slice(0, 8)}), so it is not shipped. Start a new run.`,
    );
  rmSync(join(d.ws.dir, '.git', 'index'), { force: true });
  await d.git(['checkout', '-f', '-B', s.branch, expected]);
  await d.git(['reset', '--hard', expected]);
  // -ff also removes nested folders that hold their own .git.
  await d.git(['clean', '-ffdx', '-e', 'node_modules']);
  const dirty = (await d.git(['status', '--porcelain', '--ignored'])).trim();
  if (dirty.split('\n').some((l) => l && !/^!! node_modules\/?$/.test(l)))
    throw new Error(
      `Forge's copy isn't clean after the reset, so nothing was built:\n${dirty.slice(0, 500)}`,
    );
}

async function build(d: ShipDeps, s: ShipInfo): Promise<void> {
  await checkoutReviewed(d, s);
  if (!s.done.includes('bumped')) {
    await bump(d, s);
    step(d, s, 'bumped');
  }
  // The checks ran the changed code, which could have edited node_modules: build from the lockfile.
  await npm(d, ['ci'], 'Reinstalling dependencies (npm ci)', 30 * MIN);
  await npm(d, ['run', 'dist'], 'Building the installer (npm run dist)', 45 * MIN);
  const built = join(d.ws.dir, 'dist', `Jarvis-Setup-${s.version ?? ''}.exe`);
  if (!existsSync(built)) throw new Error(`npm run dist finished but ${built} is missing.`);
  const { installer, previous } = storeInstaller(built, d.installersDir);
  s.installer = installer;
  if (previous) s.previousInstaller = previous;
}

async function merge(d: ShipDeps, s: ShipInfo): Promise<void> {
  // dev may have moved while the installer was built.
  await d.git(['fetch', '--prune', 'origin'], { timeoutMs: 10 * MIN });
  const release = s.release ?? '';
  const dev = await sha(d, `refs/remotes/origin/${BASE_BRANCH}`);
  await d.git(['checkout', '-f', '-B', BASE_BRANCH, dev]);
  const ff = (await d.git(['merge-base', dev, release])).trim() === dev;
  try {
    if (ff) await d.git(['merge', '--ff-only', release]);
    else
      await d.git([
        'merge',
        '--no-ff',
        '--no-edit',
        '-m',
        `Merge ${s.branch} (v${s.version ?? ''})`,
        release,
      ]);
    Object.assign(s, { merge: ff ? 'fast-forward' : 'merge commit', merged: await sha(d, 'HEAD') });
  } catch (err) {
    await d.git(['merge', '--abort']).catch(() => undefined);
    throw new Error(
      `Merging ${s.branch} into ${BASE_BRANCH} hit a conflict, so nothing was merged or pushed: ${errorMessage(err)}`,
      { cause: err },
    );
  }
}

function step(d: ShipDeps, s: ShipInfo, done: ShipStep): void {
  s.done = [...s.done, done];
  d.onChange();
}

/** Runs the steps not done yet, in order; throws with a plain reason at the first failure. */
export async function shipChange(deps: ShipDeps, s: ShipInfo): Promise<void> {
  // npm ci and npm run dist run package scripts that could rewrite .git/config (a remote, an
  // insteadOf, a credential helper): it is put back before every git call, not just once.
  const d: ShipDeps = {
    ...deps,
    git: (args, opts) => {
      deps.ws.restoreConfig();
      return deps.git(args, opts);
    },
  };
  const todo = (x: ShipStep): boolean => !s.done.includes(x) && !d.signal.aborted;
  if (todo('built')) {
    await build(d, s);
    step(d, s, 'built');
  }
  // Before Sir can install it: an older Jarvis can't open a database a newer one migrated.
  if (todo('backed-up')) {
    s.backup = d.backup();
    step(d, s, 'backed-up');
  }
  if (todo('merged')) {
    d.onStep(`Merging into ${BASE_BRANCH}`);
    await merge(d, s);
    step(d, s, 'merged');
  }
  const tag = `v${s.version ?? ''}`;
  const merged = s.merged ?? '';
  if (todo('tagged')) {
    await d.git(['tag', '-a', tag, '-m', `Jarvis ${tag} (Forge)`, merged]);
    step(d, s, 'tagged');
  }
  if (todo('pushed')) {
    if ((await sha(d, `refs/tags/${tag}`)) !== merged)
      throw new Error(
        `The tag ${tag} no longer points at the merged commit, so nothing was pushed.`,
      );
    d.onStep(`Pushing ${BASE_BRANCH} and ${tag} to GitHub`);
    await d.git(
      [
        'push',
        '--atomic',
        'origin',
        `${merged}:refs/heads/${BASE_BRANCH}`,
        `refs/tags/${tag}:refs/tags/${tag}`,
      ],
      { timeoutMs: 10 * MIN },
    );
    step(d, s, 'pushed');
  }
  if (d.signal.aborted) throw new Error('Shipping was cancelled.');
}

const STEP_LABEL: Record<ShipStep, string> = {
  bumped: 'version set',
  built: 'installer built',
  'backed-up': 'your data backed up',
  merged: `merged into ${BASE_BRANCH}`,
  tagged: 'tagged',
  pushed: 'pushed to GitHub',
};

export function describeShip(s: ShipInfo): string {
  const v = s.version ? ` v${s.version}${s.fromVersion ? ` (from ${s.fromVersion})` : ''}` : '';
  return [
    `Shipping${v}: ${s.state.toUpperCase()}. Approved by Sir.`,
    `Done: ${s.done.length ? s.done.map((x) => STEP_LABEL[x] + (x === 'merged' && s.merge ? ` (${s.merge})` : '')).join(', ') : 'nothing yet'}.`,
    ...(s.installer ? [`Installer: ${s.installer}`] : []),
    ...(s.backup ? [`Backup of your data: ${s.backup}`] : []),
    ...(s.error ? [`Stopped: ${s.error}`] : []),
  ].join('\n');
}
