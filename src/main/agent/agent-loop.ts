import type Anthropic from '@anthropic-ai/sdk';
import type { Citation } from '@shared/types';
import { isAbortError } from '../errors';
import type { NewMessage } from '../db/repos/conversations-repo';
import type { BudgetGuard } from '../llm/budget-guard';
import type { UsageLedger } from '../llm/usage-ledger';
import type {
  LlmClient,
  LlmMessage,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '../llm/types';
import type { TurnPurpose } from './model-router';

export const HALT_TEXT = 'Not executed: an earlier action in this turn failed.';

export interface TurnContext {
  turnId: string;
  conversationId: string;
  mode: 'text' | 'voice';
  purpose: TurnPurpose;
  signal: AbortSignal;
  /** Set once the turn has consumed untrusted content (Security.md §6.3). */
  taint: { tainted: boolean; source?: string };
}

/** What the loop needs from the tool system (implemented by tools/executor in Phase 2). */
export interface ToolRuntime {
  definitions(): Anthropic.ToolUnion[];
  execute(block: ToolUseBlock, ctx: TurnContext): Promise<ToolResultBlockParam>;
  isBatchToolset(block: ToolUseBlock): boolean;
}

export const NO_TOOLS: ToolRuntime = {
  definitions: () => [],
  execute: async (block) => ({
    type: 'tool_result',
    tool_use_id: block.id,
    is_error: true,
    content: 'No tools are available.',
  }),
  isBatchToolset: () => false,
};

export interface LoopDeps {
  llm: LlmClient;
  tools: ToolRuntime;
  budget: BudgetGuard;
  ledger: UsageLedger;
  maxIterations: number;
  maxTokens?: number;
}

export interface LoopRequest {
  model: string;
  system: Anthropic.TextBlockParam[];
  messages: MessageParam[];
  withCache?: (messages: MessageParam[]) => MessageParam[];
}

export interface LoopHooks {
  onText(delta: string): void;
  /** Called after every step with messages to persist, so history stays valid even if the app dies. */
  persist(messages: NewMessage[]): void;
  onStep?(message: LlmMessage): void;
}

export interface LoopResult {
  outcome: 'end_turn' | 'max_iterations' | 'aborted';
  text: string;
  citations: Citation[];
  iterations: number;
}

export function textOfContent(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

function citationsOf(content: Anthropic.ContentBlock[]): Citation[] {
  const out: Citation[] = [];
  for (const b of content) {
    if (b.type !== 'text' || !b.citations) continue;
    for (const c of b.citations) {
      if (c.type === 'web_search_result_location' && !out.some((o) => o.url === c.url))
        out.push({ url: c.url, title: c.title ?? c.url });
    }
  }
  return out;
}

function errorResult(block: ToolUseBlock, text: string): ToolResultBlockParam {
  const toolset = (block as { toolset_name?: string | null }).toolset_name;
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    is_error: true,
    content: text,
    ...(toolset ? { toolset_name: toolset } : {}),
  };
}

/** API-Guide.md §3.4 / Architecture.md §5. */
export async function runAgentLoop(
  deps: LoopDeps,
  ctx: TurnContext,
  req: LoopRequest,
  hooks: LoopHooks,
): Promise<LoopResult> {
  const messages = [...req.messages];
  let fullText = '';
  const citations: Citation[] = [];
  let turnInputTokens = 0;

  for (let i = 0; i < deps.maxIterations; i++) {
    if (ctx.signal.aborted) return { outcome: 'aborted', text: fullText, citations, iterations: i };
    deps.budget.assertCanSpend(turnInputTokens);

    let stepText = '';
    let msg: LlmMessage;
    try {
      msg = await deps.llm.stream(
        {
          model: req.model,
          max_tokens: deps.maxTokens ?? 4096,
          system: req.system,
          tools: deps.tools.definitions(),
          messages: req.withCache ? req.withCache(messages) : [...messages],
        },
        {
          signal: ctx.signal,
          onText: (d) => {
            stepText += d;
            hooks.onText(d);
          },
        },
      );
    } catch (err) {
      if (!isAbortError(err) && !ctx.signal.aborted) throw err;
      if (stepText) {
        hooks.persist([
          {
            role: 'assistant',
            content: [{ type: 'text', text: stepText }],
            textPlain: stepText,
            source: 'text',
            model: req.model,
            stopReason: 'interrupted',
          },
        ]);
      }
      return { outcome: 'aborted', text: fullText + stepText, citations, iterations: i + 1 };
    }

    hooks.onStep?.(msg);
    const usage = deps.ledger.record(msg, ctx.purpose, ctx.conversationId);
    turnInputTokens += usage.inputTokens;
    const stepPlain = textOfContent(msg.content);
    fullText += stepPlain;
    for (const c of citationsOf(msg.content))
      if (!citations.some((o) => o.url === c.url)) citations.push(c);
    const assistantMsg: NewMessage = {
      role: 'assistant',
      content: msg.content,
      textPlain: stepPlain,
      source: 'text',
      model: msg.model,
      stopReason: msg.stop_reason,
      usage: {
        input: msg.usage.input_tokens,
        output: msg.usage.output_tokens,
        cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
      },
    };
    messages.push({ role: 'assistant', content: msg.content });

    const toolUses = msg.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) {
      hooks.persist([assistantMsg]);
      // Server tools (web search) can pause a long turn; sending the content back resumes it.
      if (msg.stop_reason === 'pause_turn') continue;
      return { outcome: 'end_turn', text: fullText, citations, iterations: i + 1 };
    }

    // Every tool_use gets exactly one tool_result, in order (sequential execution).
    const results: ToolResultBlockParam[] = [];
    let failed = false;
    for (const block of toolUses) {
      if (ctx.signal.aborted) {
        results.push(errorResult(block, 'Not executed: Sir stopped this turn.'));
        continue;
      }
      if (failed) {
        results.push(errorResult(block, HALT_TEXT));
        continue;
      }
      const r = await deps.tools.execute(block, ctx);
      results.push(r);
      if (r.is_error && deps.tools.isBatchToolset(block)) failed = true;
    }
    messages.push({ role: 'user', content: results });
    hooks.persist([
      assistantMsg,
      { role: 'user', content: results, textPlain: '', source: 'system' },
    ]);
  }

  if (ctx.signal.aborted)
    return { outcome: 'aborted', text: fullText, citations, iterations: deps.maxIterations };
  const limitText = `\n\nI've stopped after ${deps.maxIterations} steps, sir, to avoid running away with this. Tell me if you'd like me to continue.`;
  hooks.onText(limitText);
  hooks.persist([
    {
      role: 'assistant',
      content: [{ type: 'text', text: limitText.trim() }],
      textPlain: limitText.trim(),
      source: 'text',
      model: req.model,
      stopReason: 'max_iterations',
    },
  ]);
  return {
    outcome: 'max_iterations',
    text: fullText + limitText,
    citations,
    iterations: deps.maxIterations,
  };
}
