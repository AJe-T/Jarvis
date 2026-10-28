import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { errorMessage } from '../errors';
import { bossRules, DELEGATE_RULE, type BossResult, type CheckFn, type DelegateFn } from './boss';
import { describeReport, runGate, runGates, type GateReport, type GateRunner } from './gates';
import { describeShip, shipChange, type ShipInfo } from './ship';
import {
  installTool,
  prepareToolBuild,
  runToolGates,
  toolCheck,
  type McpAccess,
  type ToolInfo,
  type ToolRunner,
} from './tool-build';
import { toolRules } from './tool-runtime';
import { createDelegateEdit, type WorkerDeps, type WorkerStats } from './workers';
import type { DiffStat, GitFn, Workspace } from './workspace';

/**
 * One Forge run (docs/Forge.md §3). A **change** (F1–F2): prepare the clone → npm ci → the boss
 * builds it → commit on the run's branch → every gate; after Sir approves, it ships (F5,
 * forge/ship.ts). A **tool** (F3):
 * the boss writes a sandboxed tool in its own build folder → the tool's checks → it waits for Sir
 * to install it. In both, the boss can hand small edits to free AIs (F4). One run at a time.
 */

export type ForgeState =
  'preparing' | 'installing' | 'building' | 'checking' | 'passed' | 'failed' | 'cancelled';

export interface ForgeRun {
  id: string;
  kind: 'change' | 'tool';
  goal: string;
  approved: string[];
  state: ForgeState;
  startedAt: number;
  endedAt?: number;
  branch?: string;
  /** A change run: the commit it started from, and lines added/removed per file (for approval). */
  base?: string;
  stat?: DiffStat[];
  /** The commit the checks ran on; the only one F5 may ship. */
  head?: string;
  /** Phase F5: shipping after Sir approved it. */
  ship?: ShipInfo;
  /** A tool run: its name, build folder, the tools it lists, and whether it was installed. */
  tool?: { name: string; buildDir?: string; tools: ToolInfo[]; installed?: 'added' | 'updated' };
  /** What the boss is doing right now, newest last (capped). */
  log: string[];
  summary?: string;
  costUsd?: number;
  report?: GateReport;
  workers: WorkerStats;
  error?: string;
}

export interface BossInput {
  repoDir: string;
  brief: string;
  rules: string;
  approved: readonly string[];
  budgetUsd: number;
  signal: AbortSignal;
  check: CheckFn;
  changedFiles(): Promise<string>;
  delegate?: DelegateFn;
  onProgress(text: string): void;
}

export interface ForgeDeps {
  /** The clone and a runner for its npm scripts; throws with a plain reason (no Node.js…). */
  workspace(): Promise<{ ws: Workspace; run: GateRunner; git: GitFn }>;
  boss(input: BossInput): Promise<BossResult>;
  repoUrl(): string;
  budgetUsd(): number;
  announce(title: string, text: string): void;
  runsDir: string;
  /** Phase F3: tool builds (forge folder, a sandbox runner, the MCP connections). */
  tools?: {
    forgeDir: string;
    runner(dir: string): Promise<ToolRunner>;
    mcp(): McpAccess | null;
  };
  /** Phase F4: free AIs for delegate_edit. */
  workers?: WorkerDeps;
  /** Phase F5: shipping a passed change, and undoing it. */
  ship?: {
    installersDir: string;
    /** Where the last shipped build is kept: Sir installs it, Jarvis restarts, then may roll back. */
    file: string;
    /** Backs up Sir's database (settings live in it); returns the file. */
    backup(): string;
    /** Schedules that backup to replace the database on the next start. */
    restore(backupFile: string): void;
  };
  now?: () => number;
}

export type StartRequest =
  | { kind: 'change'; goal: string; approved: readonly string[] }
  | { kind: 'tool'; goal: string; name: string };

export interface Forge {
  /** Starts a run in the background; throws when one is running or Forge isn't set up. */
  start(req: StartRequest): ForgeRun;
  /** The current run, or the last one since Jarvis started. */
  status(): ForgeRun | null;
  cancel(): boolean;
  /** Installs the checked tool of the last run (Sir confirms first, in forge_install_tool). */
  installTool(): Promise<'added' | 'updated'>;
  /** Ships the last run in the background after Sir approved it (forge_approve). */
  approve(runId: string): ForgeRun;
  /** The last shipped (or partly shipped) build, also after a restart. */
  lastShip(): ShipInfo | null;
  /** Schedules the restore of the data backed up before the last Forge build. */
  rollback(): ShipInfo;
}

const MAX_LOG = 40;
const RULES_CHARS = 20_000;
const FINISHED: readonly ForgeState[] = ['passed', 'failed', 'cancelled'];

/** forge/<date>-<time>-<first words of the goal>: readable in `git branch`, safe as a ref name. */
export function runSlug(goal: string, at: number): string {
  const words = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
  const stamp = new Date(at).toISOString().slice(0, 19).replace(/\D/g, '');
  return words ? `${stamp}-${words}` : stamp;
}

export function createForge(deps: ForgeDeps): Forge {
  const now = deps.now ?? Date.now;
  let current: ForgeRun | null = null;
  let controller: AbortController | null = null;

  const snapshot = (r: ForgeRun): ForgeRun => ({
    ...r,
    log: [...r.log],
    approved: [...r.approved],
    workers: { ...r.workers },
    ...(r.tool ? { tool: { ...r.tool, tools: [...r.tool.tools] } } : {}),
    ...(r.stat ? { stat: r.stat.map((s) => ({ ...s })) } : {}),
    ...(r.ship ? { ship: { ...r.ship, done: [...r.ship.done] } } : {}),
  });
  const busy = (r: ForgeRun | null): boolean =>
    r !== null && (!FINISHED.includes(r.state) || r.ship?.state === 'running');
  const progress = (r: ForgeRun, text: string): void => {
    r.log = [...r.log, text].slice(-MAX_LOG);
  };

  function save(r: ForgeRun): void {
    try {
      mkdirSync(deps.runsDir, { recursive: true });
      writeFileSync(join(deps.runsDir, `${r.id}.json`), JSON.stringify(r, null, 2), 'utf8');
    } catch {
      // The run's history file is a convenience; the result is still reported.
    }
  }

  function finish(r: ForgeRun, state: ForgeState, extra: Partial<ForgeRun> = {}): void {
    Object.assign(r, extra, { state, endedAt: now() });
    save(r);
    const what = r.kind === 'tool' ? `The tool "${r.tool?.name ?? ''}"` : `"${r.goal}"`;
    if (state === 'passed' && r.kind === 'tool')
      deps.announce(
        'Forge',
        `${what} is built and checked (${(r.tool?.tools ?? []).map((t) => t.name).join(', ')}). Say "install it" to add it; I'll ask first.`,
      );
    else if (state === 'passed')
      deps.announce(
        'Forge',
        `${what} is built and every check passed (branch ${r.branch ?? ''}). Say "approve it" to ship it as a new version; I'll show you the change first.`,
      );
    else if (state === 'failed')
      deps.announce('Forge', `${what} did not pass: ${r.error ?? 'see the Forge status'}.`);
    else deps.announce('Forge', `${what} was cancelled.`);
  }

  function delegateFor(r: ForgeRun, repoDir: string, signal: AbortSignal): DelegateFn | undefined {
    if (!deps.workers) return undefined;
    return createDelegateEdit({
      deps: deps.workers,
      repoDir,
      approved: r.approved,
      signal,
      stats: r.workers,
      onProgress: (t) => progress(r, t),
    });
  }

  /** The boss's result: false when the run must stop (cancelled or the boss gave up). */
  function afterBoss(r: ForgeRun, boss: BossResult, signal: AbortSignal): boolean {
    r.summary = boss.summary;
    r.costUsd = boss.costUsd;
    if (signal.aborted) {
      finish(r, 'cancelled');
      return false;
    }
    if (!boss.ok) {
      finish(r, 'failed', { error: boss.summary.split('\n')[0] ?? 'the build stopped' });
      return false;
    }
    return true;
  }

  async function executeChange(r: ForgeRun, signal: AbortSignal): Promise<void> {
    const { ws, run } = await deps.workspace();
    const { branch, base } = await ws.prepare(deps.repoUrl(), runSlug(r.goal, r.startedAt));
    r.branch = branch;
    r.state = 'installing';
    progress(r, 'Installing dependencies (npm ci)');
    const inst = await ws.install(signal);
    if (signal.aborted) return finish(r, 'cancelled');
    if (!inst.ok) return finish(r, 'failed', { error: `npm ci failed:\n${inst.out.slice(-2000)}` });

    r.state = 'building';
    const check: CheckFn = (c, files) => {
      if (c === 'test') return runGate(run, files.length ? 'related' : 'unit', files, signal, now);
      return runGate(run, c, [], signal, now);
    };
    const repoRules = [
      ws.readText('CLAUDE.md', RULES_CHARS),
      ws.readText('conversations/RULES.md', RULES_CHARS),
    ].join('\n\n');
    const delegate = delegateFor(r, ws.dir, signal);
    const boss = await deps.boss({
      repoDir: ws.dir,
      brief: r.goal,
      rules: bossRules(r.approved, repoRules, Boolean(delegate)),
      approved: r.approved,
      budgetUsd: deps.budgetUsd(),
      signal,
      check,
      changedFiles: () => ws.status(),
      ...(delegate ? { delegate } : {}),
      onProgress: (t) => progress(r, t),
    });
    // Kept on the run's branch even when unfinished, so nothing the boss did is lost.
    const committed = signal.aborted
      ? false
      : await ws.commit(
          `feat(forge): ${r.goal.split('\n')[0]?.slice(0, 60) ?? ''}\n\nBuilt by Jarvis Forge, run ${r.id}.`,
        );
    if (!afterBoss(r, boss, signal)) return;
    if (!committed)
      return finish(r, 'failed', { error: 'the boss finished without changing any file' });

    r.state = 'checking';
    // Ignored files the boss wrote (.env, out/…) are not in the diff, so they must not reach the checks.
    await ws.clean();
    const { files, patch, truncated, stat, head } = await ws.changes(base);
    Object.assign(r, { base, stat, head });
    if (truncated)
      return finish(r, 'failed', { error: 'the change is too large to review in full' });
    const report = await runGates(
      { run, now },
      { files, patch, approved: r.approved, signal, onGate: (id) => progress(r, `Gate: ${id}`) },
    );
    if (signal.aborted) return finish(r, 'cancelled', { report });
    const failed = report.results.find((g) => !g.ok);
    return finish(r, report.ok ? 'passed' : 'failed', {
      report,
      ...(failed ? { error: `the ${failed.id} check failed` } : {}),
    });
  }

  async function executeTool(r: ForgeRun, signal: AbortSignal): Promise<void> {
    const t = deps.tools;
    if (!t || !r.tool) throw new Error('Building tools is not available.');
    const name = r.tool.name;
    const dir = prepareToolBuild(t.forgeDir, name, runSlug('', r.startedAt));
    r.tool = { ...r.tool, buildDir: dir };
    const runner = await t.runner(dir);
    r.state = 'building';
    const delegate = delegateFor(r, dir, signal);
    const boss = await deps.boss({
      repoDir: dir,
      brief: r.goal,
      rules: toolRules(name) + (delegate ? DELEGATE_RULE : ''),
      approved: [],
      budgetUsd: deps.budgetUsd(),
      signal,
      check: (c) => toolCheck(runner, dir, c, signal),
      changedFiles: () => Promise.resolve(readdirSync(dir).join('\n')),
      ...(delegate ? { delegate } : {}),
      onProgress: (text) => progress(r, text),
    });
    if (!afterBoss(r, boss, signal)) return;
    r.state = 'checking';
    const report = await runToolGates(runner, dir, signal, (id) => progress(r, `Check: ${id}`));
    if (signal.aborted) return finish(r, 'cancelled', { report });
    r.tool = { ...r.tool, tools: report.tools };
    const failed = report.results.find((g) => !g.ok);
    return finish(r, report.ok ? 'passed' : 'failed', {
      report,
      ...(failed ? { error: `the ${failed.id} check failed` } : {}),
    });
  }

  function saveShip(r: ForgeRun): void {
    save(r);
    if (!deps.ship || !r.ship) return;
    try {
      mkdirSync(dirname(deps.ship.file), { recursive: true });
      writeFileSync(deps.ship.file, JSON.stringify(r.ship, null, 2), 'utf8');
    } catch (err) {
      // Shipping goes on; only a rollback after a restart needs the file.
      progress(r, `Could not save the ship record: ${errorMessage(err)}`);
    }
  }

  async function executeShip(r: ForgeRun, s: ShipInfo, signal: AbortSignal): Promise<void> {
    const sd = deps.ship;
    if (!sd) throw new Error('Shipping is not available.');
    const { ws, run, git } = await deps.workspace();
    await shipChange(
      {
        ws,
        git,
        run,
        installersDir: sd.installersDir,
        backup: () => sd.backup(),
        signal,
        onStep: (t) => progress(r, t),
        onChange: () => saveShip(r),
      },
      s,
    );
    s.state = 'shipped';
    saveShip(r);
    deps.announce(
      'Forge',
      `Jarvis v${s.version ?? ''} is built, merged into dev and pushed to GitHub. Installer: ${s.installer ?? ''}. Close Jarvis and run it when you're ready; your data was backed up first, and "roll back Forge" undoes it. Your own copy of the source catches up with git pull.${s.merge === 'merge commit' ? ' Note: dev had newer commits, so a merge commit was made; the installer was built from the branch before that merge.' : ''}`,
    );
  }

  function readShipFile(): ShipInfo | null {
    if (!deps.ship || !existsSync(deps.ship.file)) return null;
    try {
      // The record is a file in Sir's profile: only well-formed values reach the rollback dialog.
      const s = JSON.parse(readFileSync(deps.ship.file, 'utf8')) as ShipInfo;
      const version = (v: unknown): boolean => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
      const exe = (p: unknown): boolean =>
        p === undefined || (typeof p === 'string' && /^[^\n<>|"*?]+\.exe$/i.test(p));
      const ok =
        typeof s.runId === 'string' &&
        Array.isArray(s.done) &&
        version(s.version) &&
        version(s.fromVersion) &&
        exe(s.installer) &&
        exe(s.previousInstaller) &&
        typeof s.backup === 'string';
      return ok ? s : null;
    } catch {
      return null;
    }
  }

  return {
    start(req) {
      if (current && busy(current))
        throw new Error(`Forge is already working on "${current.goal}". Cancel it or wait.`);
      if (req.kind === 'change' && !deps.repoUrl())
        throw new Error(
          'Forge is not set up yet: it needs the GitHub address of the Jarvis repository.',
        );
      if (req.kind === 'tool' && !deps.tools) throw new Error('Building tools is not available.');
      const startedAt = now();
      const r: ForgeRun = {
        id: `forge_${startedAt.toString(36)}`,
        kind: req.kind,
        goal: req.goal,
        approved: req.kind === 'change' ? [...req.approved] : [],
        state: 'preparing',
        startedAt,
        log: [],
        workers: { free: 0, boss: 0 },
        ...(req.kind === 'tool' ? { tool: { name: req.name, tools: [] } } : {}),
      };
      current = r;
      controller = new AbortController();
      const signal = controller.signal;
      void (r.kind === 'tool' ? executeTool(r, signal) : executeChange(r, signal)).catch(
        (err: unknown) =>
          finish(r, signal.aborted ? 'cancelled' : 'failed', { error: errorMessage(err) }),
      );
      return snapshot(r);
    },
    status: () => (current ? snapshot(current) : null),
    cancel() {
      if (!busy(current) || !controller) return false;
      controller.abort();
      return true;
    },
    approve(runId) {
      const r = current;
      if (!deps.ship) throw new Error('Shipping is not available.');
      if (!r || r.kind !== 'change' || r.state !== 'passed' || !r.branch || !r.head)
        throw new Error('Only a change run that passed every check can be shipped. Run one first.');
      // Sir approved what the dialog showed: that exact run.
      if (r.id !== runId)
        throw new Error(`Run ${runId} is not the last Forge run (${r.id}); nothing was shipped.`);
      if (r.ship?.state === 'shipped')
        throw new Error(`This run is already shipped as v${r.ship.version ?? ''}.`);
      if (r.ship?.state === 'running') throw new Error('This run is being shipped right now.');
      // A ship that stopped (push refused, merge conflict…) resumes at the step that failed.
      const { error: _old, ...prev } = r.ship ?? {
        runId: r.id,
        goal: r.goal,
        branch: r.branch,
        head: r.head,
        done: [],
        at: now(),
      };
      const s: ShipInfo = { ...prev, state: 'running' };
      r.ship = s;
      controller = new AbortController();
      const signal = controller.signal;
      saveShip(r);
      void executeShip(r, s, signal).catch((err: unknown) => {
        Object.assign(s, {
          state: signal.aborted ? 'cancelled' : 'failed',
          error: errorMessage(err),
        });
        saveShip(r);
        deps.announce(
          'Forge',
          signal.aborted
            ? 'Shipping was cancelled.'
            : `Shipping stopped: ${s.error ?? ''}. Nothing was retried; approve again to continue from that step.`,
        );
      });
      return snapshot(r);
    },
    lastShip() {
      const s = current?.ship ?? readShipFile();
      return s ? { ...s, done: [...s.done] } : null;
    },
    rollback() {
      const s = current?.ship ?? readShipFile();
      if (!deps.ship || !s?.backup || !s.version || !s.done.includes('backed-up'))
        throw new Error('No Forge build has been shipped yet, so there is nothing to roll back.');
      deps.ship.restore(s.backup);
      return { ...s, done: [...s.done] };
    },
    async installTool() {
      const r = current;
      const mcp = deps.tools?.mcp();
      if (!r || r.kind !== 'tool' || r.state !== 'passed' || !r.tool?.buildDir || !deps.tools)
        throw new Error('No checked tool is waiting to be installed. Build one first.');
      if (r.tool.installed) throw new Error(`The tool "${r.tool.name}" is already installed.`);
      if (!mcp) throw new Error('Connections are still starting; try again in a moment.');
      const runner = await deps.tools.runner(r.tool.buildDir);
      const how = await installTool({
        forgeDir: deps.tools.forgeDir,
        buildDir: r.tool.buildDir,
        name: r.tool.name,
        nodeExe: runner.nodeExe,
        mcp,
      });
      r.tool = { ...r.tool, installed: how };
      save(r);
      return how;
    },
  };
}

export function describeRun(r: ForgeRun, at: number): string {
  const mins = Math.round(((r.endedAt ?? at) - r.startedAt) / 60_000);
  const what = r.kind === 'tool' ? `tool "${r.tool?.name ?? ''}"` : `"${r.goal}"`;
  const where = r.branch ? `, branch ${r.branch}` : '';
  const cost = r.costUsd ? `, about $${r.costUsd.toFixed(2)} of Claude` : '';
  const head = `Forge run ${r.id} ${what}: ${r.state.toUpperCase()} after ${mins} min${where}${cost}.`;
  const w = r.workers;
  const workers =
    w.free + w.boss > 0
      ? [`Free AIs did ${w.free} of ${w.free + w.boss} handed-off edits; Claude did the rest.`]
      : [];
  const tools = r.tool?.tools.length
    ? [
        '',
        `Tools${r.tool.installed ? ' (installed)' : ''}:`,
        ...r.tool.tools.map((t) => `- ${t.name}: ${t.description}`),
      ]
    : [];
  return [
    head,
    ...(r.error ? [`Why: ${r.error}`] : []),
    ...workers,
    ...tools,
    ...(r.log.length ? ['', 'Latest steps:', ...r.log.slice(-8).map((l) => `- ${l}`)] : []),
    ...(r.ship ? ['', describeShip(r.ship)] : []),
    ...(r.report ? ['', 'Checks:', describeReport(r.report)] : []),
    ...(r.summary ? ['', "Claude's summary:", r.summary] : []),
  ].join('\n');
}
