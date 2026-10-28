import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BossResult } from './boss';
import { createForge, describeRun, runSlug, type BossInput, type ForgeDeps } from './forge';
import type { GateRunner } from './gates';
import type { GitFn, Workspace } from './workspace';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(opts: {
  boss?: (input: BossInput) => Promise<BossResult>;
  files?: Array<{ status: string; path: string }>;
  failGate?: string;
  repoUrl?: string;
  committed?: boolean;
  /** A git call whose first argument is this fails. */
  failGit?: string;
  shipFile?: string;
}) {
  const runsDir = mkdtempSync(join(tmpdir(), 'forge-runs-'));
  const repo = mkdtempSync(join(tmpdir(), 'forge-repo-'));
  dirs.push(runsDir, repo);
  mkdirSync(join(repo, 'docs'));
  writeFileSync(join(repo, 'package.json'), '{\n  "name": "jarvis",\n  "version": "2.37.0"\n}\n');
  writeFileSync(
    join(repo, 'package-lock.json'),
    JSON.stringify({ version: '2.37.0', packages: { '': { version: '2.37.0' } } }),
  );
  writeFileSync(
    join(repo, 'docs', 'BIBLE.md'),
    '| Version | What arrived |\n|---|---|\n| 2.37 | F3 |\n',
  );
  const calls: string[] = [];
  const restore = vi.fn();
  const ws: Workspace = {
    dir: repo,
    restoreConfig: () => calls.push('restoreConfig'),
    prepare: vi.fn((_url: string, slug: string) => {
      calls.push('prepare');
      return Promise.resolve({ branch: `forge/${slug}`, base: 'abc123' });
    }),
    install: () => {
      calls.push('install');
      return Promise.resolve({ ok: true, out: '' });
    },
    commit: (msg) => {
      calls.push(`commit:${msg.split('\n')[0] ?? ''}`);
      return Promise.resolve(opts.committed ?? true);
    },
    clean: () => {
      calls.push('clean');
      return Promise.resolve();
    },
    changes: () =>
      Promise.resolve({
        files: opts.files ?? [{ status: 'M', path: 'src/main/a.ts' }],
        patch: '',
        truncated: false,
        stat: [{ path: 'src/main/a.ts', added: 12, removed: 3 }],
        head: 'aaa111',
      }),
    status: () => Promise.resolve(''),
    readText: (rel) =>
      existsSync(join(repo, rel)) ? readFileSync(join(repo, rel), 'utf8') : `contents of ${rel}`,
  };
  // A tiny model of the clone: the run's commit, the version bump on top, dev, the merge result.
  let tip = 'aaa111';
  let merged = false;
  const git: GitFn = (args) => {
    calls.push(`git:${args.join(' ')}`);
    if (opts.failGit && args[0] === opts.failGit)
      return Promise.reject(new Error(`git ${opts.failGit}: refused`));
    if (args[0] === 'commit') tip = 'bbb222';
    if (args[0] === 'merge' && args[1] !== '--abort') merged = true;
    if (args[0] === 'merge-base') return Promise.resolve('ddd000\n');
    if (args[0] !== 'rev-parse') return Promise.resolve('');
    const ref = args.at(-1) ?? '';
    if (ref.startsWith('refs/remotes/')) return Promise.resolve('ddd000\n');
    if (ref.startsWith('refs/tags/') || (ref.startsWith('HEAD') && merged))
      return Promise.resolve('eee333\n');
    return Promise.resolve(`${tip}\n`);
  };
  const run: GateRunner = (cmd) => {
    const label = 'npm' in cmd ? cmd.npm.join(' ') : cmd.node.join(' ');
    calls.push(`gate:${label}`);
    if (label === 'run dist') {
      mkdirSync(join(repo, 'dist'), { recursive: true });
      writeFileSync(join(repo, 'dist', 'Jarvis-Setup-2.38.0.exe'), 'exe');
    }
    return Promise.resolve({
      code: opts.failGate && label.includes(opts.failGate) ? 1 : 0,
      out: 'out',
    });
  };
  const announce = vi.fn();
  const bossInputs: BossInput[] = [];
  const deps: ForgeDeps = {
    workspace: () => Promise.resolve({ ws, run, git }),
    boss: (input) => {
      bossInputs.push(input);
      return (
        opts.boss ??
        (() => Promise.resolve({ ok: true, summary: 'Built it.', costUsd: 1.5, turns: 9 }))
      )(input);
    },
    repoUrl: () => opts.repoUrl ?? 'git@github.com:AJe-T/Jarvis.git',
    budgetUsd: () => 5,
    announce,
    runsDir,
    ship: {
      installersDir: join(runsDir, 'installers'),
      file: opts.shipFile ?? join(runsDir, 'last-ship.json'),
      backup: () => {
        calls.push('backup');
        return 'C:/forge/backups/jarvis-20261028-0800.db';
      },
      restore,
    },
    now: () => Date.UTC(2026, 9, 28, 8, 0, 0),
  };
  return { forge: createForge(deps), deps, calls, announce, bossInputs, runsDir, repo, restore };
}

async function settle(forge: ReturnType<typeof createForge>): Promise<void> {
  await vi.waitFor(() =>
    expect(['passed', 'failed', 'cancelled']).toContain(forge.status()?.state),
  );
}

describe('Forge runs', () => {
  it('prepares, installs, builds, commits and passes every gate, then tells Sir', async () => {
    const { forge, calls, announce, bossInputs, runsDir } = setup({});
    forge.start({
      kind: 'change',
      goal: 'Add a weather tool that reads the public API',
      approved: [],
    });
    await settle(forge);
    const r = forge.status();
    expect(r?.state).toBe('passed');
    expect(r?.branch).toBe('forge/20261028080000-add-a-weather-tool-that');
    expect(r?.costUsd).toBe(1.5);
    // Ignored files are cleaned away after the commit, before any check runs.
    expect(calls.slice(0, 4)).toEqual([
      'prepare',
      'install',
      'commit:feat(forge): Add a weather tool that reads the public API',
      'clean',
    ]);
    expect(calls.filter((c) => c.startsWith('gate:'))).toHaveLength(7);
    expect(bossInputs[0]?.rules).toContain('contents of CLAUDE.md');
    expect(bossInputs[0]?.rules).toContain('contents of conversations/RULES.md');
    expect(bossInputs[0]?.budgetUsd).toBe(5);
    expect(announce).toHaveBeenCalledWith('Forge', expect.stringContaining('every check passed'));
    expect(readdirSync(runsDir)).toHaveLength(1);
  });

  it('a protected change fails the run without running the checks', async () => {
    const { forge, calls, announce } = setup({
      files: [{ status: 'M', path: 'src/main/security/guards.ts' }],
    });
    forge.start({ kind: 'change', goal: 'Change the guards somehow, please', approved: [] });
    await settle(forge);
    expect(forge.status()?.state).toBe('failed');
    expect(forge.status()?.error).toBe('the review check failed');
    expect(calls.some((c) => c.startsWith('gate:'))).toBe(false);
    expect(announce).toHaveBeenCalledWith('Forge', expect.stringContaining('did not pass'));
  });

  it('a failing gate fails the run and names it', async () => {
    const { forge } = setup({ failGate: 'test:e2e' });
    forge.start({
      kind: 'change',
      goal: 'Add a weather tool that reads the public API',
      approved: [],
    });
    await settle(forge);
    expect(forge.status()).toMatchObject({ state: 'failed', error: 'the e2e check failed' });
    expect(describeRun(forge.status()!, Date.now())).toContain('FAIL e2e');
  });

  it("keeps an unfinished boss's work on the branch but fails the run", async () => {
    const { forge, calls } = setup({
      boss: () =>
        Promise.resolve({
          ok: false,
          summary: "Stopped: it reached this run's budget.",
          costUsd: 5,
          turns: 40,
        }),
    });
    forge.start({
      kind: 'change',
      goal: 'Add a weather tool that reads the public API',
      approved: [],
    });
    await settle(forge);
    expect(forge.status()?.state).toBe('failed');
    expect(forge.status()?.error).toContain('budget');
    expect(calls.some((c) => c.startsWith('commit:'))).toBe(true);
    expect(calls.some((c) => c.startsWith('gate:'))).toBe(false);
  });

  it('no change at all is a failure, not a pass', async () => {
    const { forge } = setup({ committed: false });
    forge.start({
      kind: 'change',
      goal: 'Add a weather tool that reads the public API',
      approved: [],
    });
    await settle(forge);
    expect(forge.status()?.error).toContain('without changing any file');
  });

  it('one run at a time; cancel stops it', async () => {
    let release: () => void = () => undefined;
    const { forge, announce } = setup({
      boss: (input) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, summary: '', costUsd: 0, turns: 1 });
          input.signal.addEventListener('abort', () => release());
        }),
    });
    forge.start({
      kind: 'change',
      goal: 'Add a weather tool that reads the public API',
      approved: [],
    });
    expect(() =>
      forge.start({ kind: 'change', goal: 'Another change entirely for Jarvis', approved: [] }),
    ).toThrow(/already working/);
    await vi.waitFor(() => expect(forge.status()?.state).toBe('building'));
    expect(forge.cancel()).toBe(true);
    await settle(forge);
    expect(forge.status()?.state).toBe('cancelled');
    expect(forge.cancel()).toBe(false);
    expect(announce).toHaveBeenCalledWith('Forge', expect.stringContaining('cancelled'));
  });

  it('a tool run needs the tool builder; the status counts free-AI edits', () => {
    const { forge } = setup({});
    expect(() =>
      forge.start({ kind: 'tool', goal: 'A tool that adds two numbers', name: 'calc' }),
    ).toThrow(/not available/);
    const r = forge.start({
      kind: 'change',
      goal: 'Add a weather tool that reads the public API',
      approved: [],
    });
    expect(describeRun({ ...r, workers: { free: 3, boss: 1 } }, Date.now())).toContain(
      'Free AIs did 3 of 4 handed-off edits',
    );
  });

  it('refuses to start before the repository is set', () => {
    const { forge } = setup({ repoUrl: '' });
    expect(() =>
      forge.start({
        kind: 'change',
        goal: 'Add a weather tool that reads the public API',
        approved: [],
      }),
    ).toThrow(/not set up/);
  });

  it('keeps the lines added and removed per file for the approval', async () => {
    const { forge } = setup({});
    forge.start({
      kind: 'change',
      goal: 'Add a weather tool that reads the public API',
      approved: [],
    });
    await settle(forge);
    expect(forge.status()).toMatchObject({
      base: 'abc123',
      stat: [{ path: 'src/main/a.ts', added: 12, removed: 3 }],
    });
  });

  it('branch names are readable and safe', () => {
    expect(runSlug('Add "dark mode" to the Settings page!', Date.UTC(2026, 0, 2, 3, 4, 5))).toBe(
      '20260102030405-add-dark-mode-to-the',
    );
    expect(runSlug('???', Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('20260102030405');
  });
});

describe('Forge shipping (F5)', () => {
  const GOAL = 'Add a weather tool that reads the public API';

  async function passed(s: ReturnType<typeof setup>): Promise<void> {
    s.forge.start({ kind: 'change', goal: GOAL, approved: [] });
    await settle(s.forge);
    expect(s.forge.status()?.state).toBe('passed');
  }
  async function shipped(forge: ReturnType<typeof createForge>): Promise<void> {
    await vi.waitFor(() => expect(forge.status()?.ship?.state).not.toBe('running'));
  }

  it('refuses to ship anything but a passed change run', async () => {
    const s = setup({ failGate: 'test:e2e' });
    expect(() => s.forge.approve('forge_x')).toThrow(/passed every check/);
    s.forge.start({ kind: 'change', goal: GOAL, approved: [] });
    await settle(s.forge);
    expect(() => s.forge.approve('forge_x')).toThrow(/passed every check/);
  });

  it('bumps, builds from a fresh npm ci, backs up, merges, tags and pushes, in that order', async () => {
    const s = setup({});
    await passed(s);
    s.calls.length = 0;
    expect(() => s.forge.approve('forge_other')).toThrow(/not the last Forge run/);
    s.forge.approve(s.forge.status()!.id);
    expect(() => s.forge.start({ kind: 'change', goal: GOAL, approved: [] })).toThrow(
      /already working/,
    );
    await shipped(s.forge);
    const ship = s.forge.status()?.ship;
    expect(ship).toMatchObject({
      state: 'shipped',
      fromVersion: '2.37.0',
      version: '2.38.0',
      merge: 'fast-forward',
      backup: 'C:/forge/backups/jarvis-20261028-0800.db',
      done: ['bumped', 'built', 'backed-up', 'merged', 'tagged', 'pushed'],
    });
    expect(ship?.installer).toBe(join(s.runsDir, 'installers', 'Jarvis-Setup-2.38.0.exe'));
    // .git/config is put back before every git call.
    s.calls.forEach((c, i) => {
      if (c.startsWith('git:')) expect(s.calls[i - 1]).toBe('restoreConfig');
    });
    const order = s.calls
      .filter((c) => c !== 'restoreConfig' && !c.startsWith('git:rev-parse'))
      .map((c) => c.split(' ').slice(0, 2).join(' '));
    expect(order).toEqual([
      'git:checkout -f',
      'git:reset --hard',
      'git:clean -ffdx',
      'git:status --porcelain',
      'git:add --',
      'git:commit -m',
      'gate:ci',
      'gate:run dist',
      'backup',
      'git:fetch --prune',
      'git:checkout -f',
      'git:merge-base ddd000',
      'git:merge --ff-only',
      'git:tag -a',
      'git:push --atomic',
    ]);
    // Only commit ids reach checkout, merge, tag and push: never a name a planted tag could shadow.
    expect(s.calls).toContain(
      'git:checkout -f -B forge/20261028080000-add-a-weather-tool-that aaa111',
    );
    expect(s.calls).toContain('git:merge --ff-only bbb222');
    expect(s.calls).toContain(
      'git:push --atomic origin eee333:refs/heads/dev refs/tags/v2.38.0:refs/tags/v2.38.0',
    );
    expect(s.calls).toContain('git:add -- package.json package-lock.json docs/BIBLE.md');
    expect(readFileSync(join(s.repo, 'package.json'), 'utf8')).toContain('"version": "2.38.0"');
    expect(readFileSync(join(s.repo, 'docs', 'BIBLE.md'), 'utf8')).toContain(
      `| 2.38 | **Built by Forge:** ${GOAL} |`,
    );
    expect(s.announce).toHaveBeenLastCalledWith(
      'Forge',
      expect.stringContaining('Jarvis-Setup-2.38.0.exe'),
    );
    expect(() => s.forge.approve(s.forge.status()!.id)).toThrow(/already shipped/);
    expect(describeRun(s.forge.status()!, Date.now())).toContain('SHIPPED');
  });

  it('a refused push is reported, not retried; approving again resumes at the push', async () => {
    const s = setup({ failGit: 'push' });
    await passed(s);
    s.forge.approve(s.forge.status()!.id);
    await shipped(s.forge);
    expect(s.forge.status()?.ship?.state).toBe('failed');
    expect(s.forge.status()?.ship?.error).toContain('refused');
    expect(s.calls.filter((c) => c.startsWith('git:push'))).toHaveLength(1);
    expect(s.announce).toHaveBeenLastCalledWith(
      'Forge',
      expect.stringContaining('Nothing was retried'),
    );
    s.calls.length = 0;
    s.forge.approve(s.forge.status()!.id);
    await shipped(s.forge);
    // Nothing before the push runs again: no second build, backup or tag; the tag is re-checked.
    expect(s.calls.filter((c) => c !== 'restoreConfig')).toEqual([
      'git:rev-parse --verify --end-of-options refs/tags/v2.38.0^{commit}',
      expect.stringMatching(/^git:push/),
    ]);
  });

  it('a merge conflict stops before tagging and pushing, and the merge is aborted', async () => {
    const s = setup({ failGit: 'merge' });
    await passed(s);
    s.forge.approve(s.forge.status()!.id);
    await shipped(s.forge);
    const ship = s.forge.status()?.ship;
    expect(ship?.state).toBe('failed');
    expect(ship?.error).toMatch(/conflict/);
    expect(ship?.done).toEqual(['bumped', 'built', 'backed-up']);
    expect(s.calls.some((c) => c.startsWith('git:tag') || c.startsWith('git:push'))).toBe(false);
  });

  it('rollback restores the backup from before the last build, even after a restart', async () => {
    const s = setup({});
    expect(() => s.forge.rollback()).toThrow(/nothing to roll back/);
    await passed(s);
    s.forge.approve(s.forge.status()!.id);
    await shipped(s.forge);
    // Jarvis restarted (Sir installed the build): only the record on disk is left.
    const again = createForge({ ...s.deps });
    expect(again.status()).toBeNull();
    expect(again.lastShip()?.version).toBe('2.38.0');
    const r = again.rollback();
    expect(s.restore).toHaveBeenCalledWith('C:/forge/backups/jarvis-20261028-0800.db');
    expect(r.fromVersion).toBe('2.37.0');
  });

  it('a tampered ship record is ignored', async () => {
    const s = setup({});
    await passed(s);
    s.forge.approve(s.forge.status()!.id);
    await shipped(s.forge);
    const file = join(s.runsDir, 'last-ship.json');
    const rec = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...rec, version: '2.38.0\nRun evil.exe instead' }));
    const again = createForge({ ...s.deps });
    expect(again.lastShip()).toBeNull();
    expect(() => again.rollback()).toThrow(/nothing to roll back/);
  });
});
