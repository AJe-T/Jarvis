import { z } from 'zod';
import { FORGE_REPO_RE } from '@shared/forge';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import { describeRun, type Forge } from './forge';
import { isProtected } from './protected';

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
          const r = deps.forge.start(goal, allowProtected);
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
        return Promise.resolve(
          ok(r ? describeRun(r, now()) : 'Forge has not run since Jarvis started.'),
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
