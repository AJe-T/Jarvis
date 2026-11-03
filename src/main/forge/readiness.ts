import { FORGE_REPO_RE } from '@shared/forge';

/**
 * Forge F12: "is this PC ready for Forge?" Everything a real run needs, checked in one go, each with a
 * plain fix. The Forge page shows it as the first-run checklist; nothing here changes anything.
 */

export type ReadyState = 'ok' | 'warn' | 'missing';

export interface ReadyCheck {
  id: 'repo' | 'node' | 'git' | 'claude' | 'vault' | 'workers' | 'budget';
  label: string;
  state: ReadyState;
  /** What was found. */
  detail: string;
  /** How to fix it (empty when ok). */
  fix: string;
  /** A run can't start without it. */
  required: boolean;
}

export interface ReadinessDeps {
  repoUrl(): string;
  node(): Promise<{ version: string } | null>;
  /** Node new enough for self-built tools (22.14+ / 24+). */
  nodeRunsTools(version: string): boolean;
  /** Node new enough for studying an app with REA (22.19+ / 24.11+). */
  nodeRunsRea(version: string): boolean;
  gitVersion(): Promise<string | null>;
  claude(): Promise<{ found: boolean; loggedIn: boolean }>;
  vaultReady(): boolean;
  freeWorkers(): { enabled: boolean; poolReady: boolean };
  budgetUsd(): number;
}

export async function readiness(d: ReadinessDeps): Promise<ReadyCheck[]> {
  const [node, git, claude] = await Promise.all([
    d.node().catch(() => null),
    d.gitVersion().catch(() => null),
    d.claude().catch(() => ({ found: false, loggedIn: false })),
  ]);
  const repo = d.repoUrl();
  const workers = d.freeWorkers();
  const checks: ReadyCheck[] = [
    repo && FORGE_REPO_RE.test(repo)
      ? {
          id: 'repo',
          label: 'Your Jarvis repository',
          state: 'ok',
          detail: repo,
          fix: '',
          required: true,
        }
      : {
          id: 'repo',
          label: 'Your Jarvis repository',
          state: 'missing',
          detail: 'Not set yet.',
          fix: 'Tell Forge: "use git@github.com:<you>/Jarvis.git for Forge" (it asks first). Forge clones it into its own folder.',
          required: true,
        },
    !node
      ? {
          id: 'node',
          label: 'Node.js',
          state: 'missing',
          detail: 'Not found on this PC.',
          fix: 'Install the current Node.js LTS from nodejs.org, then press Check again.',
          required: true,
        }
      : !d.nodeRunsTools(node.version)
        ? {
            id: 'node',
            label: 'Node.js',
            state: 'warn',
            detail: `${node.version}: changes work, self-built tools need 22.14+ (or 24+).`,
            fix: 'Update Node.js from nodejs.org to build tools too.',
            required: false,
          }
        : {
            id: 'node',
            label: 'Node.js',
            state: 'ok',
            detail: `${node.version}${d.nodeRunsRea(node.version) ? '' : ' (studying apps with REA needs 22.19+)'}`,
            fix: '',
            required: true,
          },
    git
      ? { id: 'git', label: 'Git', state: 'ok', detail: git, fix: '', required: true }
      : {
          id: 'git',
          label: 'Git',
          state: 'missing',
          detail: 'Not found on this PC.',
          fix: 'Install Git for Windows from git-scm.com, then press Check again.',
          required: true,
        },
    !claude.found
      ? {
          id: 'claude',
          label: 'Claude Code',
          state: 'missing',
          detail: 'Not found.',
          fix: 'Install Claude Code (Settings → Models & AI shows how), then sign in.',
          required: true,
        }
      : claude.loggedIn
        ? {
            id: 'claude',
            label: 'Claude Code',
            state: 'ok',
            detail: 'Signed in.',
            fix: '',
            required: true,
          }
        : {
            id: 'claude',
            label: 'Claude Code',
            state: 'missing',
            detail: 'Installed but not signed in.',
            fix: 'Settings → Models & AI → Claude subscription → Sign in.',
            required: true,
          },
    d.vaultReady()
      ? {
          id: 'vault',
          label: 'Memory vault',
          state: 'ok',
          detail: "Forge's chats and memory have a home.",
          fix: '',
          required: true,
        }
      : {
          id: 'vault',
          label: 'Memory vault',
          state: 'missing',
          detail: 'Not set up.',
          fix: 'Settings → Memory: pick a vault folder. Forge keeps its chats and notes in its Forge folder.',
          required: true,
        },
    !workers.enabled
      ? {
          id: 'workers',
          label: 'Free AIs for small edits',
          state: 'warn',
          detail: 'Switched off: Claude does every edit (it works, it just costs more).',
          fix: 'Switch on forge.freeWorkers and the AI Router to save Claude spend.',
          required: false,
        }
      : workers.poolReady
        ? {
            id: 'workers',
            label: 'Free AIs for small edits',
            state: 'ok',
            detail: 'Ready (no-training providers first).',
            fix: '',
            required: false,
          }
        : {
            id: 'workers',
            label: 'Free AIs for small edits',
            state: 'warn',
            detail: 'No free AI key yet: Claude does every edit.',
            fix: 'AI Router → API keys: add a Groq, Cerebras or Cloudflare key.',
            required: false,
          },
    {
      id: 'budget',
      label: 'Budget per run',
      state: 'ok',
      detail: `Up to $${d.budgetUsd()} of Claude per run; the run stops there and keeps its work.`,
      fix: '',
      required: false,
    },
  ];
  return checks;
}

/** A run can start when every required check is ok. */
export const canStart = (checks: ReadyCheck[]): boolean =>
  checks.every((c) => !c.required || c.state === 'ok');

/** The first build Forge suggests: small, useful, a self-built tool (no reinstall, sandboxed). */
export const FIRST_RUN_REQUEST =
  'Let\'s do my first Forge run, a small one. Learn to convert currencies: build a self-built tool called "currency" that converts an amount from one currency to another with the free Frankfurter API (https://api.frankfurter.app, no key needed). Input: amount, from and to (ISO codes like USD, EUR, INR). Output: the converted amount, the rate and the date of the rate. Refuse unknown currency codes with a clear message, and say so when the API cannot be reached. Include tests.';
