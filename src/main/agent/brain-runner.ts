import { POOL_TOOLS, privateSourceOf } from '@shared/free-pool';
import { JarvisError } from '../errors';
import type { BrainRef } from '../llm/brains';
import type { Trail } from '../llm/pool/pool';
import { findSensitive } from '../security/redact';
import type { Services } from '../services';
import { runAgentLoop, type LoopResult, type ToolRuntime, type TurnContext } from './agent-loop';
import { pickModel } from './model-router';

/** A tool runtime that only offers, and only runs, the allowed tools. */
export function restrictTools(base: ToolRuntime, allowed: (name: string) => boolean): ToolRuntime {
  return {
    definitions: () => base.definitions().filter((d) => allowed((d as { name: string }).name)),
    catalog: () => (base.catalog?.() ?? []).filter((t) => allowed(t.name)),
    isBatchToolset: () => false,
    execute: (block, ctx) =>
      allowed(block.name)
        ? base.execute(block, ctx)
        : Promise.resolve({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: `${block.name} is not available to this sub-agent.`,
          }),
  };
}

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
export async function runOnBrain(s: Services, brain: BrainRef, job: BrainJob): Promise<LoopResult> {
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
  if (brain === 'free') return runOnPool(s, job);
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
      budget: s.brains.paid(brain) ? s.paidBudget : s.budget,
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

/**
 * AI Router (Security.md §16.15): the free pool gets only work with none of Sir's private data.
 * Checked here in code, not left to the AI: a conversation that read a private source (in any
 * turn, or in a call still running beside this one) is refused, a prompt that carries a key,
 * password or card is refused, and the pool's sub-agent gets only public lookup tools.
 */
async function runOnPool(s: Services, job: BrainJob): Promise<LoopResult> {
  const why =
    job.turn.taint.privateSource ??
    job.turn.taint.privateData ??
    privateInConversation(s, job.turn.conversationId) ??
    (findSensitive(`${job.system}\n${job.prompt}`).length ? 'private data in the task' : null);
  if (why)
    throw new JarvisError(
      'POLICY_BLOCKED',
      'private data for the free pool',
      `Free AIs never get Sir's private data (this task involves ${why}). Do it yourself, or use the local model.`,
    );
  if (!s.pool.ready())
    throw new JarvisError(
      'INVALID',
      'free pool not ready',
      'The free AI pool has no key yet (AI Router → Providers & keys), or it is switched off.',
    );
  const title = job.prompt.split('\n')[0]?.slice(0, 120) ?? '';
  const llm = s.pool.session({
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    task: title,
  });
  const tools = restrictTools(job.tools, (name) => POOL_TOOLS.has(name));
  // A third-party answer is outside content, like a web page: what Jarvis does after reading it
  // needs Sir's confirmation (the delegate_task result is marked untrusted from this taint), even
  // when the loop stops with an error afterwards.
  let result: LoopResult;
  try {
    result = await runAgentLoop(
      {
        llm,
        tools,
        budget: s.budget,
        ledger: s.ledger,
        maxIterations: job.maxSteps,
        maxTokens: job.maxTokens,
      },
      job.turn,
      {
        model: 'pool',
        system: [{ type: 'text', text: job.system }],
        messages: [{ role: 'user', content: job.prompt }],
      },
      { onText: () => undefined, persist: () => undefined },
    );
  } finally {
    if (llm.trail.attempts.some((a) => a.ok && a.tier === 3)) {
      job.turn.taint.tainted = true;
      job.turn.taint.source ??= 'a third-party AI (tier 3)';
    }
  }
  return { ...result, text: `${result.text}\n\n${trailLine(llm.trail)}` };
}

/**
 * The first private source this conversation touched, in any turn or in a tool call running
 * right now beside the delegation (tool_calls rows exist before the tool runs).
 */
function privateInConversation(s: Services, conversationId: string): string | null {
  const rows = s.db
    .prepare(
      "SELECT DISTINCT tool_name, source FROM tool_calls WHERE conversation_id = ? AND status IN ('pending', 'running', 'success')",
    )
    .all(conversationId) as Array<{ tool_name: string; source: string }>;
  for (const r of rows) {
    const found = privateSourceOf({ name: r.tool_name, source: r.source });
    if (found) return `${found} earlier in this conversation`;
  }
  return null;
}

/** "(Free pool: answered by Cerebras · gpt-oss-120b; tried Groq: rate limited.)" */
export function trailLine(trail: Trail): string {
  const done = trail.attempts.filter((a) => a.ok).at(-1);
  const failed = trail.attempts.filter((a) => !a.ok);
  const tried = failed.length
    ? `; tried ${failed.map((f) => `${f.name}: ${f.reason ?? 'failed'}`).join(', ')}`
    : '';
  const third = done?.tier === 3 ? ', a third-party AI' : '';
  return done
    ? `(Free pool: answered by ${done.name}${third} · ${done.model}${tried}.)`
    : `(Free pool${tried}.)`;
}
