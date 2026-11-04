import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { StagePanel } from '@shared/stage';
import { MAX_ARTIFACT_CHARS } from '@shared/stage';
import { errorMessage } from '../errors';
import type { ClaudeCodeRuntime } from '../llm/claude-code';
import { systemNode } from '../lib/process';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import { FIGURE_PAGE, runFigureAgent, type FigureRunResult, type FigureSize } from './agent';

/**
 * Figure jobs: one at a time, in the background. explain_visually answers at once ("started"), so
 * the voice turn ends and Sir can keep talking; when the figure is done it opens beside the orb and
 * Jarvis says so (Windows notification, toast, and spoken when he isn't talking: services.announce).
 */

const INSTALL =
  "The Anatomy skill isn't installed for Claude Code. Sir can install it once in a terminal with: npx skills add wheresryan22/anatomy -g -a claude-code (MIT licence; it needs Node 20.10+ and Chrome or Edge).";

export interface FigureJob {
  topic: string;
  folder: string;
  startedAt: number;
  progress: string;
}

export interface FigureDeps {
  rt: ClaudeCodeRuntime;
  /** Parent folder: each figure gets its own sub-folder (Documents\Jarvis\Figures). */
  dir(): string;
  skill(): string | null;
  offline(): boolean;
  announce(title: string, text: string): void;
  show(panel: StagePanel): void;
  /** Tests: stand-ins for Node and the Claude Code run. */
  node?(): Promise<{ exe: string; version: string } | null>;
  run?(input: Parameters<typeof runFigureAgent>[0]): Promise<FigureRunResult>;
  now?(): Date;
}

/** Local time and a short name, so two figures never share a folder. */
export function folderName(topic: string, d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const slug =
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'figure';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())} ${slug}`;
}

const nodeOk = (version: string): boolean => {
  const [major = 0, minor = 0] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13); // stable --permission flag
};

export function createFigureJobs(deps: FigureDeps) {
  let current: (FigureJob & { abort: AbortController }) | null = null;
  /** Set before the first await, so two quick requests can't both start a paid run. */
  let starting = false;
  const run = deps.run ?? runFigureAgent;

  async function finish(job: FigureJob, r: FigureRunResult): Promise<void> {
    const page = join(job.folder, FIGURE_PAGE);
    const size = r.ok
      ? await stat(page)
          .then((s) => s.size)
          .catch(() => -1)
      : -1;
    if (size < 0) {
      deps.announce(
        'Figure',
        `Sir, the figure of ${job.topic} didn't finish. ${r.summary.slice(0, 300)}`.trim(),
      );
      return;
    }
    const code = await readFile(page, 'utf8');
    if (code.length > MAX_ARTIFACT_CHARS) {
      deps.announce(
        'Figure',
        `Sir, your figure of ${job.topic} is ready but too big to show beside the orb. It's saved in ${job.folder}.`,
      );
      return;
    }
    deps.show({ kind: 'artifact', title: job.topic.slice(0, 80), format: 'html', code });
    deps.announce(
      'Figure',
      `Sir, your figure of ${job.topic} is ready, beside the orb. ${r.summary}`.slice(0, 600),
    );
  }

  async function begin(
    topic: string,
    size: FigureSize,
  ): Promise<{ folder: string } | { error: string }> {
    const skill = deps.skill();
    if (!skill) return { error: INSTALL };
    if (!deps.rt.path())
      return {
        error:
          'Claude Code is not installed on this PC; figures are made with it. Install it and sign in, then try again.',
      };
    const node = await (deps.node ?? systemNode)();
    if (!node || !nodeOk(node.version))
      return {
        error: `Figures need Node.js 22.13 or later on this PC (found ${node?.version ?? 'none'}). Sir can install it with: winget install OpenJS.NodeJS.LTS`,
      };
    const folder = join(deps.dir(), folderName(topic, (deps.now ?? (() => new Date()))()));
    await mkdir(folder, { recursive: true });
    const job = {
      topic,
      folder,
      startedAt: Date.now(),
      progress: 'Starting',
      abort: new AbortController(),
    };
    current = job;
    void run({
      rt: deps.rt,
      topic,
      size,
      dirs: { work: folder, skill },
      node: node.exe,
      signal: job.abort.signal,
      onProgress: (text) => (job.progress = text),
    })
      .catch((err: unknown): FigureRunResult => ({ ok: false, summary: errorMessage(err) }))
      .then((r) =>
        job.abort.signal.aborted
          ? deps.announce('Figure', `The figure of ${topic} was cancelled.`)
          : finish(job, r),
      )
      .catch((err: unknown) =>
        deps.announce('Figure', `The figure of ${topic} failed: ${errorMessage(err)}`),
      )
      .finally(() => {
        if (current === job) current = null;
      });
    return { folder };
  }

  return {
    current: (): FigureJob | null => current,
    cancel(): boolean {
      if (!current) return false;
      current.abort.abort();
      return true;
    },
    /** Starts a job and returns at once; the error is a sentence for Sir. */
    async start(topic: string, size: FigureSize): Promise<{ folder: string } | { error: string }> {
      if (deps.offline())
        return {
          error:
            'Offline mode is on, and figures are made by Claude Code in the cloud. Turn Offline mode off first.',
        };
      if (current || starting)
        return {
          error: `A figure of ${current?.topic ?? 'something else'} is still being made. Wait for it, or cancel it first.`,
        };
      starting = true;
      try {
        return await begin(topic, size);
      } finally {
        starting = false;
      }
    },
  };
}

export type FigureJobs = ReturnType<typeof createFigureJobs>;

export function createFigureTools(jobs: FigureJobs): Tool[] {
  return [
    defineTool({
      name: 'explain_visually',
      description:
        'Explain how something works with one interactive figure: Claude Code invents a real machine whose working is the idea (a cache as a pin-tumbler lock, a rate limiter as a coin hopper) and builds it with the Anatomy skill. Use when Sir asks to SEE how something works, "explain visually", "show me how X works". Takes 20–60 minutes in the background and uses Claude plan usage; it opens beside the orb when done. For a quick diagram use show_panel with an artifact instead.',
      input: z.object({
        topic: z.string().trim().min(3).max(300),
        size: z.enum(['figure', 'hero']).default('figure'),
      }),
      tier: 'CONFIRM',
      timeoutMs: 30_000,
      summarize: ({ topic }) => `Build an interactive figure: ${topic.slice(0, 80)}`,
      confirm: ({ topic, size }) => ({
        title: `Build a figure of "${topic.slice(0, 60)}"?`,
        actionLabel: 'Build figure',
        details: `Claude Code builds it in the background with the Anatomy skill: ${size === 'hero' ? 'a bigger figure, about 2–4 hours' : 'about 20–60 minutes'}, using your Claude plan (capped at about $${size === 'hero' ? 15 : 6} of usage). It opens beside the orb when it's done; you can keep talking meanwhile.`,
        detailsKind: 'text',
      }),
      async run({ topic, size }) {
        const r = await jobs.start(topic, size);
        if ('error' in r) return fail(r.error);
        return ok(
          `Started in the background (saved in ${r.folder}). Tell Sir in one short sentence that you've started and will tell him when it's ready; don't wait for it.`,
        );
      },
    }),
    defineTool({
      name: 'figure_status',
      description:
        'How the figure being built (explain_visually) is going, or cancel it with cancel: true.',
      input: z.object({ cancel: z.boolean().default(false) }).strict(),
      tier: 'SAFE',
      timeoutMs: 5_000,
      summarize: ({ cancel }) =>
        cancel ? 'Cancel the figure being built' : 'Check the figure being built',
      async run({ cancel }) {
        const job = jobs.current();
        if (!job) return ok('No figure is being built.');
        if (cancel) {
          jobs.cancel();
          return ok(`Cancelling the figure of ${job.topic}.`);
        }
        const minutes = Math.round((Date.now() - job.startedAt) / 60_000);
        return ok(`Building the figure of ${job.topic} for ${minutes} min. Now: ${job.progress}.`);
      },
    }),
  ];
}
