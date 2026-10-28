import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '../tools/types';
import type { Forge, ForgeRun } from './forge';
import type { ShipInfo } from './ship';
import { approvalDetails, createForgeTools } from './tools';

const ctx = {} as never;

const SHIP: ShipInfo = {
  runId: 'forge_1',
  goal: 'Add a weather card',
  branch: 'forge/x',
  head: 'aaa111',
  state: 'shipped',
  done: ['bumped', 'built', 'backed-up', 'merged', 'tagged', 'pushed'],
  fromVersion: '2.37.0',
  version: '2.38.0',
  installer: 'C:/f/installers/Jarvis-Setup-2.38.0.exe',
  previousInstaller: 'C:/f/installers/Jarvis-Setup-2.37.0.exe',
  backup: 'C:/f/backups/jarvis-20261028-0800.db',
  at: 0,
};

const PASSED = {
  id: 'forge_1',
  kind: 'change',
  goal: 'Add a weather card to the home page',
  approved: ['src/main/security/guards.ts'],
  state: 'passed',
  startedAt: 0,
  branch: 'forge/x',
  stat: [{ path: 'src/renderer/home.tsx', added: 40, removed: 2 }],
  summary: 'Added the card.',
  costUsd: 1.234,
  report: {
    ok: true,
    results: [],
    findings: [{ path: 'src/a.test.ts', severity: 'warn', problem: 'fewer assertions' }],
  },
  log: [],
  workers: { free: 0, boss: 0 },
} as ForgeRun;

function setup(start: Forge['start'] = vi.fn()) {
  let url = '';
  const forge: Forge = {
    start,
    status: vi.fn(() => null),
    cancel: vi.fn(() => false),
    installTool: vi.fn(() => Promise.resolve('added' as const)),
    approve: vi.fn(() => ({ id: 'forge_1' }) as ForgeRun),
    lastShip: vi.fn(() => null),
    rollback: vi.fn(() => SHIP),
    history: vi.fn(() => []),
  };
  const tools = createForgeTools({
    forge,
    repoUrl: () => url,
    setRepoUrl: (u) => (url = u),
    budgetUsd: () => 5,
  });
  const byName = (n: string): Tool => tools.find((t) => t.name === n)!;
  return { forge, byName, url: () => url };
}

describe('Forge tools', () => {
  it('setup and start ask first; status and cancel do not', () => {
    const { byName } = setup();
    expect(byName('forge_setup').tier).toBe('CONFIRM');
    expect(byName('forge_start').tier).toBe('CONFIRM');
    expect(byName('forge_status').tier).toBe('SAFE');
    expect(byName('forge_cancel').tier).toBe('SAFE');
    expect(byName('forge_approve').tier).toBe('CONFIRM');
    expect(byName('forge_rollback').tier).toBe('CONFIRM');
  });

  it('forge_approve shows Sir everything he approves: files with +/-, warnings, allowed protected files, summary, cost', () => {
    const d = approvalDetails(PASSED, 'forge_1').details ?? '';
    expect(d).toContain('Add a weather card to the home page');
    expect(d).toContain('src/renderer/home.tsx  +40 -2');
    expect(d).toContain('WARNINGS FROM THE REVIEW');
    expect(d).toContain('fewer assertions');
    expect(d).toContain('PROTECTED FILES YOU ALLOWED');
    expect(d).toContain('Added the card.');
    expect(d).toContain('$1.23');
    expect(approvalDetails({ ...PASSED, state: 'failed' }, 'forge_1').title).toBe(
      'Nothing to ship',
    );
    // The dialog is for the run Claude named; another run shows nothing to approve.
    expect(approvalDetails(PASSED, 'forge_2').title).toBe('Nothing to ship');
  });

  it('forge_approve starts shipping and reports a refusal', async () => {
    const { byName, forge } = setup();
    expect(byName('forge_approve').input.safeParse({}).success).toBe(false);
    expect((await byName('forge_approve').run({ runId: 'forge_1' }, ctx)).isError).toBeUndefined();
    expect(forge.approve).toHaveBeenCalledWith('forge_1');
    vi.mocked(forge.approve).mockImplementation(() => {
      throw new Error('Only a change run that passed every check can be shipped.');
    });
    const out = await byName('forge_approve').run({ runId: 'forge_1' }, ctx);
    expect(out.isError).toBe(true);
  });

  it('forge_rollback explains both steps, in order, with the previous installer', async () => {
    const { byName, forge } = setup();
    vi.mocked(forge.lastShip).mockReturnValue(SHIP);
    expect(byName('forge_rollback').confirm?.({}).details).toContain('Jarvis-Setup-2.37.0.exe');
    const out = await byName('forge_rollback').run({}, ctx);
    const text = JSON.stringify(out.content);
    expect(text).toContain(
      '1. Close Jarvis, then run the previous installer: C:/f/installers/Jarvis-Setup-2.37.0.exe',
    );
    expect(text).toContain('2. Start Jarvis');
    expect(text).toContain('pre-restore.db');
  });

  it('forge_status shows the last shipped build after a restart', async () => {
    const { byName, forge } = setup();
    vi.mocked(forge.lastShip).mockReturnValue(SHIP);
    const text = JSON.stringify((await byName('forge_status').run({}, ctx)).content);
    expect(text).toContain('Shipping v2.38.0 (from 2.37.0): SHIPPED');
    expect(text).toContain('Installer: C:/f/installers/Jarvis-Setup-2.38.0.exe');
  });

  it('forge_setup accepts only a github.com repository', async () => {
    const { byName, url } = setup();
    const t = byName('forge_setup');
    expect(t.input.safeParse({ repoUrl: 'https://evil.example/x.git' }).success).toBe(false);
    expect(t.input.safeParse({ repoUrl: 'C:\\Users\\me\\Jarvis' }).success).toBe(false);
    const input = t.input.parse({ repoUrl: 'git@github.com:AJe-T/Jarvis.git' });
    await t.run(input, ctx);
    expect(url()).toBe('git@github.com:AJe-T/Jarvis.git');
  });

  it('forge_start shows protected files Sir allows and starts the run', async () => {
    const start = vi.fn(() => ({ id: 'forge_1' }) as ForgeRun);
    const { byName } = setup(start);
    const t = byName('forge_start');
    const input = t.input.parse({
      goal: 'Let the guards allow one more folder',
      allowProtected: ['src/main/security/guards.ts'],
    });
    expect(t.confirm?.(input).details).toContain('PROTECTED FILES YOU ALLOW IT TO CHANGE');
    const out = await t.run(input, ctx);
    expect(out.isError).toBeUndefined();
    expect(start).toHaveBeenCalledWith({
      kind: 'change',
      goal: 'Let the guards allow one more folder',
      approved: ['src/main/security/guards.ts'],
    });
  });

  it('forge_start and forge_build_tool show what will be studied first, and refuse unclear sources (F6)', async () => {
    const start = vi.fn(() => ({ id: 'forge_1' }) as ForgeRun);
    const { byName } = setup(start);
    const t = byName('forge_start');
    const repo = t.input.parse({
      goal: 'Add a command palette like that one',
      studyApp: 'https://github.com/acme/palette',
    });
    expect(t.confirm?.(repo).details).toContain(
      'STUDIES FIRST: the GitHub repository acme/palette',
    );
    expect(t.confirm?.(repo).details).toContain('read-only copy');
    await t.run(repo, ctx);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ studyApp: 'https://github.com/acme/palette' }),
    );
    const app = byName('forge_build_tool').input.parse({
      name: 'palette',
      goal: 'A tool that ranks commands like Raycast',
      studyApp: 'Raycast',
    });
    expect(byName('forge_build_tool').confirm?.(app).details).toContain(
      'the app "Raycast", with REA',
    );
    expect(
      t.input.safeParse({ goal: 'Add a command palette like that one', studyApp: 'file:///C:/x' })
        .success,
    ).toBe(false);
  });

  it('forge_start refuses unprotected paths in allowProtected and reports start errors', async () => {
    const { byName } = setup(
      vi.fn(() => {
        throw new Error('Forge is already working on "x".');
      }),
    );
    const t = byName('forge_start');
    const bad = await t.run(
      t.input.parse({ goal: 'Some change to Jarvis here', allowProtected: ['src/a.ts'] }),
      ctx,
    );
    expect(bad.isError).toBe(true);
    const busy = await t.run(t.input.parse({ goal: 'Some change to Jarvis here' }), ctx);
    expect(JSON.stringify(busy.content)).toContain('already working');
  });

  it('forge_status says when nothing has run', async () => {
    const { byName } = setup();
    const out = await byName('forge_status').run({}, ctx);
    expect(out.content[0]).toMatchObject({ text: 'Forge has not run since Jarvis started.' });
  });
});
