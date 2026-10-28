import { z } from 'zod';
import { FORGE_REPO_RE } from '@shared/forge';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import type { ConfirmDetails } from '../tools/types';
import { describeRun, type Forge, type ForgeRun } from './forge';
import { isProtected } from './protected';
import { describeShip } from './ship';
import { connectionName, TOOL_NAME_RE } from './tool-build';

const MAX_FILES_SHOWN = 40;

/** What Sir sees before a change ships: goal, files with +/-, warnings, allowed protected files, cost. */
export function approvalDetails(r: ForgeRun | null, runId: string): Partial<ConfirmDetails> {
  if (!r || r.id !== runId || r.kind !== 'change' || r.state !== 'passed')
    return {
      title: 'Nothing to ship',
      details: `Run ${runId} is not a change run that passed every check.`,
      detailsKind: 'text',
    };
  const stat = r.stat ?? [];
  const files = stat
    .slice(0, MAX_FILES_SHOWN)
    .map((f) => `${f.path}  +${f.added} -${f.removed}`)
    .concat(stat.length > MAX_FILES_SHOWN ? [`…and ${stat.length - MAX_FILES_SHOWN} more`] : []);
  const warns = (r.report?.findings ?? []).filter((f) => f.severity === 'warn');
  return {
    title: 'Ship this change as a new Jarvis version?',
    actionLabel: 'Ship it',
    details: [
      `Goal:\n${r.goal}`,
      `Files changed (${stat.length}):\n${files.join('\n') || '(none listed)'}`,
      ...(warns.length
        ? [`WARNINGS FROM THE REVIEW:\n${warns.map((w) => `- ${w.path}: ${w.problem}`).join('\n')}`]
        : []),
      ...(r.approved.length
        ? [`PROTECTED FILES YOU ALLOWED:\n${r.approved.map((p) => `- ${p}`).join('\n')}`]
        : []),
      `Claude's summary (its own words, not checked by Forge):\n${(r.summary ?? '').slice(0, 3000)}`,
      `Claude cost: about $${(r.costUsd ?? 0).toFixed(2)}. Run ${r.id}, branch ${r.branch ?? ''}, commit ${(r.head ?? '').slice(0, 10)}. Forge also adds the version bump and, if missing, a BIBLE row; if dev moved meanwhile, a merge commit.`,
    ].join('\n\n'),
    detailsKind: 'text',
    purpose:
      'Forge bumps the version, builds the installer, backs up your data, merges into dev, tags it and pushes to GitHub. It never installs: you run the installer.',
  };
}

/**
 * Forge tools (docs/Forge.md): Sir asks for a change to Jarvis itself, Claude agrees the goal with
 * him, then forge_start builds it in Forge's own clone and checks it. Both setup and start ask first.
 */
export function createForgeTools(deps: {
  forge: Forge;
  repoUrl(): string;
  setRepoUrl(url: string): void;
  budgetUsd(): number;
  now?: () => number;
}): Tool[] {
  const now = deps.now ?? Date.now;
  return [
    defineTool({
      name: 'forge_setup',
      description:
        "Set the GitHub address of sir's Jarvis repository for Forge (Jarvis improving itself), e.g. git@github.com:owner/Jarvis.git. Forge clones it into its own folder, separate from sir's copy. Only when sir gives the address.",
      input: z.object({
        repoUrl: z.string().trim().regex(FORGE_REPO_RE, 'A github.com repository address.'),
      }),
      tier: 'CONFIRM',
      timeoutMs: 5_000,
      summarize: ({ repoUrl }) => `Use ${repoUrl} for Forge`,
      confirm: ({ repoUrl }) => ({
        title: 'Use this repository for Forge?',
        actionLabel: 'Use it',
        details: `${repoUrl}\n\nForge clones it into its own folder and runs its tests and build scripts on this PC. Only use your own Jarvis repository.`,
        detailsKind: 'text',
      }),
      async run({ repoUrl }) {
        deps.setRepoUrl(repoUrl);
        return Promise.resolve(ok(`Forge will use ${repoUrl}.`));
      },
    }),
    defineTool({
      name: 'forge_start',
      description:
        "Build a change to Jarvis itself with Forge: Claude Code works headless in Forge's own copy of the source on a new branch, with file tools only, then every check runs (protected files, typecheck, lint, related and full tests, build, e2e, secret scan). Takes from minutes to an hour; sir is told when it ends. Agree the goal with sir first and write it completely: what to build, how it should behave, edge cases. allowProtected: protected files sir explicitly approved by name for this run (normally empty). One run at a time.",
      input: z.object({
        goal: z.string().trim().min(20).max(6000),
        allowProtected: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
      }),
      tier: 'CONFIRM',
      timeoutMs: 10_000,
      summarize: ({ goal }) => `Forge: build "${goal.slice(0, 80)}"`,
      confirm: ({ goal, allowProtected }) => ({
        title: 'Let Jarvis change its own code?',
        actionLabel: 'Start Forge',
        details: `Repository: ${deps.repoUrl() || '(not set up)'}\nBudget: up to $${deps.budgetUsd()} of Claude (estimate)${allowProtected.length ? `\n\nPROTECTED FILES YOU ALLOW IT TO CHANGE:\n${allowProtected.map((p) => `- ${p}`).join('\n')}` : ''}\n\nGoal:\n${goal}`,
        detailsKind: 'text',
        purpose:
          "Claude Code edits files only in Forge's own copy and cannot run commands; Forge runs the checks. Nothing is installed or pushed.",
      }),
      async run({ goal, allowProtected }) {
        const notProtected = allowProtected.filter((p) => !isProtected(p));
        if (notProtected.length)
          return fail(
            `Not protected files, leave them out of allowProtected: ${notProtected.join(', ')}`,
          );
        try {
          const r = deps.forge.start({ kind: 'change', goal, approved: allowProtected });
          return Promise.resolve(
            ok(
              `Forge started (run ${r.id}). I'll tell sir when it finishes; forge_status shows progress.`,
            ),
          );
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    }),
    defineTool({
      name: 'forge_build_tool',
      description:
        "Build a new ability for Jarvis as a self-built tool, with no reinstall (Forge phase F3): Claude Code writes a small sandboxed Node.js tool (it can use the internet, read only its own folder and write only its data folder; no programs, no npm packages), tests it, and checks it loads. Prefer this over forge_start when the ability needs no change to Jarvis's own screens or core: fetching or converting data, calling a public API, calculations. Agree the goal with sir first and write it completely. Same name again updates that tool. Installing needs forge_install_tool after it passes.",
      input: z.object({
        name: z
          .string()
          .trim()
          .regex(TOOL_NAME_RE, 'lowercase letters, digits and -, 2–24 characters'),
        goal: z.string().trim().min(20).max(6000),
      }),
      tier: 'CONFIRM',
      timeoutMs: 10_000,
      summarize: ({ name }) => `Forge: build the tool "${name}"`,
      confirm: ({ name, goal }) => ({
        title: 'Let Jarvis build a new tool?',
        actionLabel: 'Build it',
        details: `Tool: ${name}\nBudget: up to $${deps.budgetUsd()} of Claude (estimate)\n\nGoal:\n${goal}`,
        detailsKind: 'text',
        purpose:
          'Claude Code writes the tool in its own folder and Forge tests it in a sandbox. Nothing is added to Jarvis until you install it.',
      }),
      async run({ name, goal }) {
        try {
          const r = deps.forge.start({ kind: 'tool', goal, name });
          return Promise.resolve(
            ok(
              `Forge is building the tool "${name}" (run ${r.id}). I'll tell sir when it is checked; then forge_install_tool adds it.`,
            ),
          );
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    }),
    defineTool({
      name: 'forge_install_tool',
      description:
        'Install the tool Forge just built and checked, as a connection (Settings → Connections can switch it off or remove it). Every use asks sir first unless he changes that there. Only after forge_status shows the tool run PASSED and sir wants it.',
      input: z.object({}),
      tier: 'CONFIRM',
      timeoutMs: 90_000,
      summarize: () => `Install the tool "${deps.forge.status()?.tool?.name ?? ''}"`,
      confirm: () => {
        const t = deps.forge.status()?.tool;
        return {
          title: `Install the tool "${t?.name ?? ''}"?`,
          actionLabel: 'Install',
          details: `${(t?.tools ?? []).map((x) => `- ${x.name}: ${x.description}`).join('\n')}\n\nRuns with Node's permission sandbox: it can use the internet, read only its own folder (%APPDATA%\\Jarvis\\forge\\tools\\${t?.name ?? ''}) and write only its data folder. It cannot start programs. Jarvis asks you before each use.`,
          detailsKind: 'text',
        };
      },
      async run() {
        try {
          const how = await deps.forge.installTool();
          const t = deps.forge.status()?.tool;
          return ok(
            `The tool "${t?.name ?? ''}" is ${how === 'added' ? 'installed' : 'updated'}: ${(t?.tools ?? []).map((x) => x.name).join(', ')}. It appears as the connection "${connectionName(t?.name ?? '')}" in Settings → Connections.`,
          );
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    }),
    defineTool({
      name: 'forge_approve',
      description:
        "Ship the Forge change that just passed every check, after sir approves it (Forge phase F5): in Forge's own clone it bumps the version, builds the installer, backs up sir's data, merges the branch into dev, tags it and pushes to GitHub, then reports the installer path. Takes 10–30 minutes; sir is told when it ends. Never installs: sir runs the installer himself. Only when forge_status shows a change run PASSED and sir wants it shipped; runId is the id forge_status shows. After a failed step (push refused, merge conflict) it continues from that step.",
      input: z.object({ runId: z.string().regex(/^forge_[a-z0-9]+$/) }),
      tier: 'CONFIRM',
      timeoutMs: 10_000,
      summarize: ({ runId }) => `Forge: ship run ${runId}`,
      confirm: ({ runId }) => approvalDetails(deps.forge.status(), runId),
      async run({ runId }) {
        try {
          const r = deps.forge.approve(runId);
          return Promise.resolve(
            ok(
              `Shipping run ${r.id}. I'll tell sir when the installer is ready; forge_status shows each step.`,
            ),
          );
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    }),
    defineTool({
      name: 'forge_rollback',
      description:
        "Undo the last Forge build when it broke something: schedules sir's data (database and settings) to be restored to how it was before that build, and gives him the previous installer to run. Only when sir asks to roll back.",
      input: z.object({}),
      tier: 'CONFIRM',
      timeoutMs: 30_000,
      summarize: () => `Forge: roll back v${deps.forge.lastShip()?.version ?? ''}`,
      confirm: () => {
        const s = deps.forge.lastShip();
        return {
          title: `Roll back Jarvis v${s?.version ?? ''}?`,
          actionLabel: 'Roll back',
          details: `Your data (chats, memory index, settings) goes back to how it was just before Forge built v${s?.version ?? ''}, the next time Jarvis starts. Anything newer is kept in pre-restore.db, not lost.\n\nThen run the previous installer${s?.previousInstaller ? `:\n${s.previousInstaller}` : ` for v${s?.fromVersion ?? 'the previous version'}`}`,
          detailsKind: 'text',
        };
      },
      async run() {
        try {
          const s = deps.forge.rollback();
          const installer = s.previousInstaller
            ? `run the previous installer: ${s.previousInstaller}`
            : `run the installer of v${s.fromVersion ?? 'the previous version'} (Forge has no earlier installer of its own; your own dist folder or GitHub has it)`;
          return Promise.resolve(
            ok(
              `Rollback is scheduled. Two steps for sir:\n1. Close Jarvis, then ${installer}.\n2. Start Jarvis. Before it opens anything it restores the data from just before v${s.version ?? ''} (backup ${s.backup ?? ''}); what changed since is kept in pre-restore.db.\nDo it in that order: if this newer Jarvis starts first, it restores the data and then upgrades it again.`,
            ),
          );
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    }),
    defineTool({
      name: 'forge_status',
      description:
        "What Forge is doing or how its last run ended: state, latest steps, check results and Claude Code's summary.",
      input: z.object({}),
      tier: 'SAFE',
      // The summary and check output come from code and docs in the repository.
      untrustedOutput: true,
      timeoutMs: 2_000,
      summarize: () => 'Check Forge',
      async run() {
        const r = deps.forge.status();
        const s = deps.forge.lastShip();
        return Promise.resolve(
          ok(
            r
              ? describeRun(r, now())
              : `Forge has not run since Jarvis started.${s ? `\n\nLast Forge build:\n${describeShip(s)}` : ''}`,
          ),
        );
      },
    }),
    defineTool({
      name: 'forge_cancel',
      description: 'Stop the Forge run in progress. Its work so far stays on its branch.',
      input: z.object({}),
      tier: 'SAFE',
      timeoutMs: 2_000,
      summarize: () => 'Stop Forge',
      async run() {
        return Promise.resolve(
          deps.forge.cancel() ? ok('Forge is stopping.') : ok('No Forge run is in progress.'),
        );
      },
    }),
  ];
}
