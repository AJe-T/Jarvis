import { JarvisError } from '../errors';
import type { BrainId } from '../llm/brains';
import type { Services } from '../services';
import { runAgentLoop, type LoopResult, type ToolRuntime, type TurnContext } from './agent-loop';
import { pickModel } from './model-router';

export interface BrainJob {
  system: string;
  prompt: string;
  /** Tools a loop brain may use (subscription apps get none: they only answer). */
  tools: ToolRuntime;
  maxSteps: number;
  maxTokens: number;
  turn: TurnContext;
}

/**
 * One job on one brain (sub-agents, NPCs). Loop brains run Jarvis's agent loop, so every tool call
 * still goes through policy, confirmations and Activity; a subscription app gets the text only.
 */
export async function runOnBrain(s: Services, brain: BrainId, job: BrainJob): Promise<LoopResult> {
  const cli = s.brains.cli(brain);
  if (cli) {
    // Security.md §CLI brains: these apps can read files on this PC. Text from outside (a web
    // page, an email) could steer them to read and repeat something private, so it never goes there.
    if (job.turn.taint.tainted)
      throw new JarvisError(
        'POLICY_BLOCKED',
        'cli brain on tainted turn',
        `${cli.label} only gets requests without outside content (this task read ${job.turn.taint.source ?? 'outside text'}).`,
      );
    const text = await cli.run(`${job.system}\n\n---\n\n${job.prompt}`, job.turn.signal);
    return { outcome: 'end_turn', text, citations: [], iterations: 1 };
  }
  const llm = s.brains.get(brain);
  if (!llm)
    throw new JarvisError(
      'INVALID',
      'brain not set up',
      `${s.brains.label(brain)} is not set up. Available: ${s.brains.available().join(', ')}.`,
    );
  // Jarvis's own connection may be the Claude subscription, which runs its own loop.
  const loop = brain === 'jarvis' ? s.loopFor() : runAgentLoop;
  return loop(
    {
      llm,
      tools: job.tools,
      // Another provider's API spends money whatever Jarvis's own connection is.
      budget: brain === 'jarvis' || brain === 'local' ? s.budget : s.paidBudget,
      ledger: s.ledger,
      maxIterations: job.maxSteps,
      maxTokens: job.maxTokens,
    },
    job.turn,
    {
      model: pickModel(s.settings, { purpose: 'task', text: job.prompt }),
      system: [{ type: 'text', text: job.system }],
      messages: [{ role: 'user', content: job.prompt }],
    },
    { onText: () => undefined, persist: () => undefined },
  );
}
