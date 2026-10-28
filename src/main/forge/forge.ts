import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { errorMessage } from '../errors';
import { bossRules, DELEGATE_RULE, type BossResult, type CheckFn, type DelegateFn } from './boss';
import {
  describeReport,
  runGate,
  runGates,
  type GateReport,
  type GateResult,
  type GateRunner,
} from './gates';
import { addedRuns, copyFindings, indexStudyRepo } from './nocopy';
import type { Finding } from './protected';
import { describeShip, shipChange, type ShipInfo } from './ship';
import {
  describeStudy,
  parseStudy,
  reaPolicy,
  studyRules,
  type ReaPolicy,
  type StudySource,
} from './study';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
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
  /** Phase F6: what the boss studied first, its notes, and what the no-copy check found. */
  study?: {
    source: string;
    kind: StudySource['kind'];
    notes?: string;
    /** The read-only copy of a studied repository. */
    root?: string;
    findings?: Finding[];
    /** The studied repo was too big to index in full. */
    partial?: boolean;
  };
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
  /** Phase F6: a studied repository to read, and REA's server, for this run only. */
  study?: { readRoots: string[]; mcp?: Record<string, McpServerConfig>; rea?: ReaPolicy };
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
  /** Phase F6: study a repository, app or website before building. */
  study?: {
    /** A shallow, read-only clone of a github.com repository; returns its folder. */
    cloneRepo(url: string, slug: string): Promise<string>;
    /** REA's MCP server for one run; throws with a plain reason (no Node.js 22.19+…). */
    rea(): Promise<McpServerConfig>;
  };
  /** Phase F6: the skills Sir marked "Forge" (injection-scanned and capped by the skill store). */
  skills?(): Promise<{ text: string; skipped: string[] }>;
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
  | { kind: 'change'; goal: string; approved: readonly string[]; studyApp?: string | undefined }
  | { kind: 'tool'; goal: string; name: string; studyApp?: string | undefined };

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
  /** F7: every saved run, newest first, for Settings → Forge (the current one included). */
  history(): ForgeRunView[];
}

/** One run as the Forge page shows it: no logs beyond the last steps, nothing from the repo but text. */
export interface ForgeRunView {
  id: string;
  kind: 'change' | 'tool';
  goal: string;
  state: ForgeState;
  startedAt: number;
  endedAt: number | null;
  costUsd: number;
  branch: string | null;
  tool: string | null;
  error: string | null;
  freeEdits: number;
  claudeEdits: number;
  checks: Array<{ id: string; ok: boolean }>;
  ship: {
    state: ShipInfo['state'];
    version: string | null;
    done: string[];
    installer: string | null;
    error: string | null;
  } | null;
  study: {
    source: string;
    notes: string | null;
    blocks: number;
    warns: number;
    partial: boolean;
  } | null;
  summary: string;
  log: string[];
}

const MAX_HISTORY = 100;
/** Run files read for the page (newest names), and the largest one read: a run file is a few KB. */
const MAX_RUN_FILES = 500;
const MAX_RUN_FILE_BYTES = 1_000_000;
const SHIP_STATES: readonly ShipInfo['state'][] = ['running', 'shipped', 'failed', 'cancelled'];
const STATES: readonly ForgeState[] = [
  'preparing',
  'installing',
  'building',
  'checking',
  'passed',
  'failed',
  'cancelled',
];

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.slice(0, max) : null;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * A saved run file → the page's view. The files are Jarvis's own, but a run's summary and log come
 * from the repo's code and Claude: everything is type-checked and capped, and shown as plain text.
 */
export function runView(r: ForgeRun, installersDir?: string): ForgeRunView | null {
  if (typeof r.id !== 'string' || typeof r.goal !== 'string' || !Number.isFinite(r.startedAt))
    return null;
  const objects = <T>(v: unknown): T[] =>
    Array.isArray(v) ? v.filter((x): x is T => typeof x === 'object' && x !== null) : [];
  const findings = objects<Finding>(r.study?.findings);
  const results = objects<GateResult>(r.report?.results);
  // An installer path is only shown when it is in Forge's own installers folder.
  const installer = str(r.ship?.installer, 400);
  const ownInstaller =
    installer &&
    installersDir &&
    resolve(installer)
      .toLowerCase()
      .startsWith(resolve(installersDir).toLowerCase() + sep)
      ? installer
      : null;
  return {
    id: r.id.slice(0, 64),
    kind: r.kind === 'tool' ? 'tool' : 'change',
    goal: r.goal.slice(0, 600),
    state: STATES.includes(r.state) ? r.state : 'failed',
    startedAt: r.startedAt,
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : null,
    costUsd: num(r.costUsd),
    branch: str(r.branch, 200),
    tool: str(r.tool?.name, 64),
    error: str(r.error, 500),
    freeEdits: num(r.workers?.free),
    claudeEdits: num(r.workers?.boss),
    checks: results.map((g) => ({ id: String(g.id).slice(0, 20), ok: g.ok === true })),
    ship: r.ship
      ? {
          state: SHIP_STATES.includes(r.ship.state) ? r.ship.state : 'failed',
          version: str(r.ship.version, 20),
          done: Array.isArray(r.ship.done) ? r.ship.done.map((d) => String(d).slice(0, 20)) : [],
          installer: ownInstaller,
          error: str(r.ship.error, 500),
        }
      : null,
    study: r.study
      ? {
          source: String(r.study.source).slice(0, 300),
          notes: str(r.study.notes, 400),
          blocks: findings.filter((f) => f.severity === 'block').length,
          warns: findings.filter((f) => f.severity === 'warn').length,
          partial: r.study.partial === true,
        }
      : null,
    summary: str(r.summary, 4000) ?? '',
    log: (Array.isArray(r.log) ? r.log : []).slice(-8).map((l) => String(l).slice(0, 300)),
  };
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
    ...(r.study
      ? { study: { ...r.study, ...(r.study.findings ? { findings: [...r.study.findings] } : {}) } }
      : {}),
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

  /**
   * F6: the study (a read-only clone of the repository, or REA) and the marked skills: extra rules
   * and access for this run's boss. `notes` is where the boss writes what it learned.
   */
  async function extrasFor(
    r: ForgeRun,
    notes: string,
    shownNotes: string,
  ): Promise<{ rules: string; study?: NonNullable<BossInput['study']> }> {
    let rules = '';
    let study: NonNullable<BossInput['study']> | undefined;
    if (r.study) {
      if (!deps.study) throw new Error('Study mode is not available.');
      const src = parseStudy(r.study.source);
      r.study = { ...r.study, notes: shownNotes };
      if (src.kind === 'repo') {
        progress(r, `Cloning ${src.owner}/${src.name} to study it (read-only)`);
        const root = await deps.study.cloneRepo(src.url, `${src.owner}-${src.name}`);
        r.study = { ...r.study, root };
        rules += studyRules(src, notes, root);
        study = { readRoots: [root] };
      } else {
        progress(r, `Starting REA to study ${describeStudy(src)}`);
        rules += studyRules(src, notes);
        study = { readRoots: [], mcp: { rea: await deps.study.rea() }, rea: reaPolicy(src) };
      }
    }
    const skills = deps.skills ? await deps.skills() : { text: '', skipped: [] };
    if (skills.skipped.length) progress(r, `Skills left out: ${skills.skipped.join(', ')}`);
    if (skills.text)
      rules += `\n\n# Skills Sir chose for Forge runs\nFollow them where they fit this change; the rules above win any conflict.\n${skills.text}`;
    return { rules, ...(study ? { study } : {}) };
  }

  /** F6: the no-copy check of a run that studied a repository (none otherwise). */
  function noCopy(r: ForgeRun, added: Map<string, string[][]>): Finding[] | undefined {
    if (!r.study?.root) return undefined;
    const index = indexStudyRepo(r.study.root);
    const findings = copyFindings(added, index);
    r.study = { ...r.study, findings, ...(index.partial ? { partial: true } : {}) };
    return findings;
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
    const notes = `docs/forge-study/${runSlug(r.goal, r.startedAt)}.md`;
    const extras = await extrasFor(r, notes, join(ws.dir, notes));
    const boss = await deps.boss({
      repoDir: ws.dir,
      brief: r.goal,
      rules: bossRules(r.approved, repoRules, Boolean(delegate)) + extras.rules,
      approved: r.approved,
      budgetUsd: deps.budgetUsd(),
      signal,
      check,
      changedFiles: () => ws.status(),
      ...(delegate ? { delegate } : {}),
      ...(extras.study ? { study: extras.study } : {}),
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
    const copied = noCopy(r, addedRuns(patch));
    const report = await runGates(
      { run, now },
      {
        files,
        patch,
        approved: r.approved,
        signal,
        onGate: (id) => progress(r, `Gate: ${id}`),
        ...(copied ? { noCopy: copied } : {}),
      },
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
    const extras = await extrasFor(r, 'study-notes.md', join(dir, 'study-notes.md'));
    const boss = await deps.boss({
      repoDir: dir,
      brief: r.goal,
      rules: toolRules(name) + (delegate ? DELEGATE_RULE : '') + extras.rules,
      approved: [],
      budgetUsd: deps.budgetUsd(),
      signal,
      check: (c) => toolCheck(runner, dir, c, signal),
      changedFiles: () => Promise.resolve(readdirSync(dir).join('\n')),
      ...(delegate ? { delegate } : {}),
      ...(extras.study ? { study: extras.study } : {}),
      onProgress: (text) => progress(r, text),
    });
    if (!afterBoss(r, boss, signal)) return;
    r.state = 'checking';
    // The tool's own files, whole, against the studied repository.
    const copied = noCopy(
      r,
      new Map(
        readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isFile() && /\.(?:mjs|json|md)$/i.test(e.name))
          .map((e) => [e.name, [readFileSync(join(dir, e.name), 'utf8').split(/\r?\n/)]]),
      ),
    );
    const blocked = (copied ?? []).filter((f) => f.severity === 'block');
    if (blocked.length)
      return finish(r, 'failed', {
        error: 'the no-copy check failed',
        report: {
          ok: false,
          results: [
            {
              id: 'no-copy',
              ok: false,
              ms: 0,
              tail: blocked.map((f) => `BLOCK ${f.path}: ${f.problem}`).join('\n'),
            },
          ],
          findings: copied ?? [],
        },
      });
    const gated = await runToolGates(runner, dir, signal, (id) => progress(r, `Check: ${id}`));
    const report = copied ? { ...gated, findings: [...gated.findings, ...copied] } : gated;
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
      // F6: an unclear studyApp is refused before anything starts.
      const study = req.studyApp ? parseStudy(req.studyApp) : null;
      if (study && !deps.study) throw new Error('Study mode is not available.');
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
        ...(study && req.studyApp ? { study: { source: req.studyApp, kind: study.kind } } : {}),
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
    history() {
      // The checks run changed code as Sir, which could plant files here: only regular, small files
      // whose name is their run id, and one bad file only drops itself.
      const views = new Map<string, ForgeRunView>();
      const view = (r: ForgeRun): ForgeRunView | null => {
        try {
          return runView(r, deps.ship?.installersDir);
        } catch {
          return null;
        }
      };
      const files = existsSync(deps.runsDir)
        ? readdirSync(deps.runsDir).filter((f) => /^forge_[a-z0-9]+\.json$/.test(f))
        : [];
      for (const f of files.sort().slice(-MAX_RUN_FILES)) {
        const p = join(deps.runsDir, f);
        try {
          const st = lstatSync(p);
          if (!st.isFile() || st.size > MAX_RUN_FILE_BYTES) continue;
          const r = JSON.parse(readFileSync(p, 'utf8')) as ForgeRun;
          const v = r?.id === f.slice(0, -'.json'.length) ? view(r) : null;
          if (v) views.set(v.id, v);
        } catch {
          // A damaged run file is left out of the list.
        }
      }
      const now = current ? view(current) : null;
      if (now) views.set(now.id, now);
      return [...views.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_HISTORY);
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

function describeStudyRun(s: NonNullable<ForgeRun['study']>): string[] {
  const findings = s.findings ?? [];
  return [
    `Studied first: ${s.source}${s.notes ? `. Study notes: ${s.notes}` : ''}${s.root ? ` (read-only copy: ${s.root})` : ''}`,
    ...(s.root
      ? findings.length
        ? [
            'No-copy check:',
            ...findings.map((f) => `- ${f.severity.toUpperCase()} ${f.path}: ${f.problem}`),
          ]
        : s.findings
          ? [
              s.partial
                ? 'No-copy check: nothing copied from the part of the studied repository it could index (it is too big to check in full).'
                : 'No-copy check: no code copied from the studied repository.',
            ]
          : []
      : []),
  ];
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
    ...(r.study ? ['', ...describeStudyRun(r.study)] : []),
    ...(r.ship ? ['', describeShip(r.ship)] : []),
    ...(r.report ? ['', 'Checks:', describeReport(r.report)] : []),
    ...(r.summary ? ['', "Claude's summary:", r.summary] : []),
  ].join('\n');
}
