import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { describePlanLimits, type PlanLimits } from '../llm/plan-limits';
import type { PathGuard } from '../security/path-guard';
import { runPowerShell } from '../tools/powershell';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import { REA_PACKAGE, nodeRunsRea, reaBrief, systemNodeVersion, writeReaConfig } from './rea';
import type { ClaudeSession, createSessionReader } from './sessions';

const LABEL: Record<ClaudeSession['state'], string> = {
  'needs-you': 'WAITING ON YOU',
  working: 'working',
  finished: 'just finished',
  idle: 'idle',
};

/**
 * Worktree name for an isolated session (idea from Paperclip / Munder Difflin): Claude Code's own
 * `--worktree` puts it at <repo>/.claude/worktrees/<name> on a new branch, so parallel sessions in
 * one repo never overwrite each other's files.
 */
export const worktreeName = (at: number, suffix = randomBytes(2).toString('hex')): string =>
  `jarvis-${new Date(at).toISOString().slice(0, 19).replace(/\D/g, '')}-${suffix}`;

const ago = (ms: number): string => {
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** One argument quoted for a Windows command line (CommandLineToArgvW rules), never shell-parsed. */
export function quoteWindowsArg(arg: string): string {
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * Opens Claude Code in its own console window; Claude Code's own permission prompts stay in charge.
 * `args` are Claude Code's arguments, the brief first (each quoted on its own, never shell-parsed).
 */
export type LaunchFn = (exe: string, args: string[], cwd: string) => Promise<void>;

/**
 * Start-Process gives the console program a new, visible console (a detached Node child has none,
 * so Claude Code's terminal UI could not start). Values travel as JSON parameters, not script text.
 * ANTHROPIC_* keys are removed first: they would silently move the session onto API billing (ADR-010).
 */
const realLaunch: LaunchFn = async (exe, args, cwd) => {
  const r = await runPowerShell(
    `Get-ChildItem Env: | Where-Object { $_.Name -like 'ANTHROPIC_*' -or $_.Name -eq 'ELECTRON_RUN_AS_NODE' } | ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }
Start-Process -FilePath $P.exe -ArgumentList $P.args -WorkingDirectory $P.dir`,
    { params: { exe, dir: cwd, args: args.map(quoteWindowsArg).join(' ') }, timeoutMs: 15_000 },
  );
  if (r.exitCode !== 0) throw new Error(r.stderr || 'Claude Code did not start.');
};

/**
 * Claude Code tools (ideas from ethanplusai/jarvis): see every Claude Code session on this PC and
 * which are waiting on Sir, check plan usage, and start a new session on a project by voice.
 */
export function createClaudeSessionTools(deps: {
  reader: ReturnType<typeof createSessionReader>;
  planLimits: () => PlanLimits | null;
  claudePath: () => string | null;
  guard: PathGuard;
  now?: () => number;
  launch?: LaunchFn;
  /** Where the per-session REA config is written (ADR-031). */
  reaConfigDir: string;
  nodeVersion?: () => Promise<string | null>;
}): Tool[] {
  const now = deps.now ?? Date.now;
  return [
    defineTool({
      name: 'claude_sessions',
      description:
        'List sir\'s Claude Code sessions on this PC from the last day: project, what it is about, and whether it is WAITING ON YOU (stuck on a permission prompt or question), working, just finished or idle. Use for "which of my Claude sessions need me?", "is my build done?". Read-only; you cannot answer prompts for him.',
      input: z.object({ onlyWaiting: z.boolean().default(false) }),
      tier: 'SAFE',
      // Session titles are Sir's prompts, which may quote pasted web text.
      untrustedOutput: true,
      timeoutMs: 20_000,
      summarize: ({ onlyWaiting }) =>
        onlyWaiting ? 'Check Claude Code sessions waiting on you' : 'List Claude Code sessions',
      async run({ onlyWaiting }) {
        const all = await deps.reader.list();
        const shown = onlyWaiting ? all.filter((s) => s.state === 'needs-you') : all;
        if (shown.length === 0)
          return ok(
            onlyWaiting
              ? 'No Claude Code session is waiting on you.'
              : 'No Claude Code sessions in the last day.',
          );
        const t = now();
        return ok(
          shown
            .map(
              (s) =>
                `- ${s.project}: ${LABEL[s.state]}${s.waitingFor ? ` (wants to use ${s.waitingFor})` : ''}, last activity ${ago(t - s.lastModified)}. "${s.title}"`,
            )
            .join('\n'),
        );
      },
    }),
    defineTool({
      name: 'claude_plan_usage',
      description:
        "How much of sir's Claude plan is used: the 5-hour window and the weekly window, with reset times, as Claude Code last reported them. Only known when you run on his Claude subscription.",
      input: z.object({}),
      tier: 'SAFE',
      timeoutMs: 2_000,
      summarize: () => 'Check Claude plan usage',
      async run() {
        return Promise.resolve(ok(describePlanLimits(deps.planLimits())));
      },
    }),
    defineTool({
      name: 'start_claude_session',
      description:
        "Open a new Claude Code session in its own window on one of sir's project folders, starting with the brief you write (what to build or fix, agreed with him first; ask it to plan, then implement with tests). Claude Code then asks sir for permissions itself; claude_sessions tells you when it is waiting on him. Needs Claude Code installed. Set isolate when another session may already be working in the same git repo (or sir asks for a separate branch): the session then works in its own git worktree and branch. When he wants something built like a feature of another app or website, put that app in studyApp: the session then gets the REA reverse-engineering tools and studies it first.",
      input: z.object({
        folder: z.string().min(1).max(500),
        /** ADR-031: an app, program or website whose feature to study first with REA. */
        studyApp: z.string().trim().min(2).max(200).optional(),
        /** Own git worktree + branch, so parallel sessions in one repo don't collide. */
        isolate: z.boolean().default(false),
        brief: z
          .string()
          .trim()
          .min(10)
          .max(4000)
          // A leading dash would be read as a Claude Code flag, not as the prompt.
          .refine((b) => !b.startsWith('-'), 'The brief must not start with "-".'),
      }),
      tier: 'CONFIRM',
      timeoutMs: 10_000,
      summarize: ({ folder, studyApp, isolate }) =>
        `Start Claude Code in ${folder}${isolate ? ' (own worktree)' : ''}${studyApp ? `, studying ${studyApp} with REA` : ''}`,
      guards: ({ folder }) => ({ paths: [folder] }),
      confirm: ({ folder, brief, studyApp, isolate }) => ({
        title: 'Start a Claude Code session?',
        actionLabel: 'Start session',
        details: `Folder: ${folder}${isolate ? '\nWorks in its own git worktree and branch (.claude\\worktrees)' : ''}${studyApp ? `\nStudies first: ${studyApp} (REA ${REA_PACKAGE}, MIT; npx downloads it the first time)` : ''}\n\nBrief:\n${brief}`,
        detailsKind: 'text',
        purpose:
          'Claude Code will open in a new window and ask you before it runs commands or edits files.',
      }),
      async run({ folder, brief, studyApp, isolate }) {
        const exe = deps.claudePath();
        if (!exe)
          return fail(
            'Claude Code is not installed. Install it from claude.com/claude-code, then sign in once.',
          );
        const dir = deps.guard.resolve(folder);
        if (!existsSync(dir) || !statSync(dir).isDirectory())
          return fail(`${dir} is not a folder.`);
        if (isolate && !existsSync(join(dir, '.git')))
          return fail(
            `${dir} is not the top folder of a git repository, so it can't get its own worktree. Start it without isolate, or pick the repository's top folder.`,
          );
        if (studyApp) {
          const node = await (deps.nodeVersion ?? systemNodeVersion)();
          if (!node || !nodeRunsRea(node))
            return fail(
              `REA needs Node.js 22.19+ (or 24.11+) on this PC; ${node ? `you have ${node}` : 'none was found'}. Install the current Node.js LTS from nodejs.org, then ask again.`,
            );
        }
        const worktree = isolate ? worktreeName(now()) : null;
        // The prompt goes first and --mcp-config last: it takes every value after it.
        const args = [
          studyApp ? reaBrief(studyApp, brief) : brief,
          ...(worktree ? ['--worktree', worktree] : []),
          ...(studyApp ? ['--mcp-config', await writeReaConfig(deps.reaConfigDir)] : []),
        ];
        try {
          await (deps.launch ?? realLaunch)(exe, args, dir);
        } catch (err) {
          return fail(
            `Claude Code didn't start: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return ok(
          `Claude Code is starting in ${dir}${worktree ? ` in its own worktree (.claude\\worktrees\\${worktree}, on its own branch)` : ''}${studyApp ? ` and will study ${studyApp} with REA first` : ''}. I'll tell you when it needs you.`,
        );
      },
    }),
  ];
}
