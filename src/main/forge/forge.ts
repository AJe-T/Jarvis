import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage } from '../errors';
import { bossRules, type BossResult, type CheckFn } from './boss';
import { describeReport, runGate, runGates, type GateReport, type GateRunner } from './gates';
import type { Workspace } from './workspace';

/**
 * One Forge run (docs/Forge.md §3, phases F1–F2): prepare the clone → install if the lockfile
 * changed → the boss builds the change → commit on the run's branch → every gate. One run at a
 * time. Shipping (version, installer, merge, push) is phase F5; until then a passed run waits on
 * its branch.
 */

export type ForgeState =
  'preparing' | 'installing' | 'building' | 'checking' | 'passed' | 'failed' | 'cancelled';

export interface ForgeRun {
  id: string;
  goal: string;
  approved: string[];
  state: ForgeState;
  startedAt: number;
  endedAt?: number;
  branch?: string;
  /** What the boss is doing right now, newest last (capped). */
  log: string[];
  summary?: string;
  costUsd?: number;
  report?: GateReport;
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
  onProgress(text: string): void;
}

export interface ForgeDeps {
  /** The clone and a runner for its npm scripts; throws with a plain reason (no Node.js…). */
  workspace(): Promise<{ ws: Workspace; run: GateRunner }>;
  boss(input: BossInput): Promise<BossResult>;
  repoUrl(): string;
  budgetUsd(): number;
  announce(title: string, text: string): void;
  runsDir: string;
  now?: () => number;
}

export interface Forge {
  /** Starts a run in the background; throws when one is running or Forge isn't set up. */
  start(goal: string, approved: readonly string[]): ForgeRun;
  /** The current run, or the last one since Jarvis started. */
  status(): ForgeRun | null;
  cancel(): boolean;
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
  });
  const progress = (r: ForgeRun, text: string): void => {
    r.log = [...r.log, text].slice(-MAX_LOG);
  };

  function finish(r: ForgeRun, state: ForgeState, extra: Partial<ForgeRun> = {}): void {
    Object.assign(r, extra, { state, endedAt: now() });
    try {
      mkdirSync(deps.runsDir, { recursive: true });
      writeFileSync(join(deps.runsDir, `${r.id}.json`), JSON.stringify(r, null, 2), 'utf8');
    } catch {
      // The run's history file is a convenience; the result is still reported below.
    }
    const what = `"${r.goal}"`;
    if (state === 'passed')
      deps.announce(
        'Forge',
        `${what} is built and every check passed (branch ${r.branch ?? ''}). Shipping it as an installer comes with Forge phase F5.`,
      );
    else if (state === 'failed')
      deps.announce('Forge', `${what} did not pass: ${r.error ?? 'see the Forge status'}.`);
    else deps.announce('Forge', `${what} was cancelled.`);
  }

  async function execute(r: ForgeRun, signal: AbortSignal): Promise<void> {
    const { ws, run } = await deps.workspace();
    r.state = 'preparing';
    const slug = runSlug(r.goal, r.startedAt);
    const { branch, base } = await ws.prepare(deps.repoUrl(), slug);
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
    const boss = await deps.boss({
      repoDir: ws.dir,
      brief: r.goal,
      rules: bossRules(r.approved, repoRules),
      approved: r.approved,
      budgetUsd: deps.budgetUsd(),
      signal,
      check,
      changedFiles: () => ws.status(),
      onProgress: (t) => progress(r, t),
    });
    r.summary = boss.summary;
    r.costUsd = boss.costUsd;
    if (signal.aborted) return finish(r, 'cancelled');
    // Kept on the run's branch even when unfinished, so nothing the boss did is lost.
    const committed = await ws.commit(
      `feat(forge): ${r.goal.split('\n')[0]?.slice(0, 60) ?? ''}\n\nBuilt by Jarvis Forge, run ${r.id}.`,
    );
    if (!boss.ok)
      return finish(r, 'failed', { error: boss.summary.split('\n')[0] ?? 'the build stopped' });
    if (!committed)
      return finish(r, 'failed', { error: 'the boss finished without changing any file' });

    r.state = 'checking';
    // Ignored files the boss wrote (.env, out/…) are not in the diff, so they must not reach the checks.
    await ws.clean();
    const { files, patch, truncated } = await ws.changes(base);
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

  return {
    start(goal, approved) {
      if (current && !FINISHED.includes(current.state))
        throw new Error(`Forge is already working on "${current.goal}". Cancel it or wait.`);
      if (!deps.repoUrl())
        throw new Error(
          'Forge is not set up yet: it needs the GitHub address of the Jarvis repository.',
        );
      const startedAt = now();
      const r: ForgeRun = {
        id: `forge_${startedAt.toString(36)}`,
        goal,
        approved: [...approved],
        state: 'preparing',
        startedAt,
        log: [],
      };
      current = r;
      controller = new AbortController();
      const signal = controller.signal;
      void execute(r, signal).catch((err: unknown) =>
        finish(r, signal.aborted ? 'cancelled' : 'failed', { error: errorMessage(err) }),
      );
      return snapshot(r);
    },
    status: () => (current ? snapshot(current) : null),
    cancel() {
      if (!current || FINISHED.includes(current.state) || !controller) return false;
      controller.abort();
      return true;
    },
  };
}

export function describeRun(r: ForgeRun, at: number): string {
  const mins = Math.round(((r.endedAt ?? at) - r.startedAt) / 60_000);
  const head = `Forge run "${r.goal}": ${r.state.toUpperCase()} after ${mins} min${r.branch ? `, branch ${r.branch}` : ''}${r.costUsd ? `, about $${r.costUsd.toFixed(2)} of Claude` : ''}.`;
  return [
    head,
    ...(r.error ? [`Why: ${r.error}`] : []),
    ...(r.log.length ? ['', 'Latest steps:', ...r.log.slice(-8).map((l) => `- ${l}`)] : []),
    ...(r.report ? ['', 'Checks:', describeReport(r.report)] : []),
    ...(r.summary ? ['', "Claude's summary:", r.summary] : []),
  ].join('\n');
}
