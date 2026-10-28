import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BossResult } from './boss';
import { createForge, describeRun, runSlug, type BossInput, type ForgeDeps } from './forge';
import type { GateRunner } from './gates';
import type { Workspace } from './workspace';

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
}) {
  const runsDir = mkdtempSync(join(tmpdir(), 'forge-runs-'));
  dirs.push(runsDir);
  const calls: string[] = [];
  const ws: Workspace = {
    dir: 'C:/forge/repo',
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
      }),
    status: () => Promise.resolve(''),
    readText: (rel) => `contents of ${rel}`,
  };
  const run: GateRunner = (cmd) => {
    const label = 'npm' in cmd ? cmd.npm.join(' ') : cmd.node.join(' ');
    calls.push(`gate:${label}`);
    return Promise.resolve({
      code: opts.failGate && label.includes(opts.failGate) ? 1 : 0,
      out: 'out',
    });
  };
  const announce = vi.fn();
  const bossInputs: BossInput[] = [];
  const deps: ForgeDeps = {
    workspace: () => Promise.resolve({ ws, run }),
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
    now: () => Date.UTC(2026, 9, 28, 8, 0, 0),
  };
  return { forge: createForge(deps), calls, announce, bossInputs, runsDir };
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

  it('branch names are readable and safe', () => {
    expect(runSlug('Add "dark mode" to the Settings page!', Date.UTC(2026, 0, 2, 3, 4, 5))).toBe(
      '20260102030405-add-dark-mode-to-the',
    );
    expect(runSlug('???', Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('20260102030405');
  });
});
