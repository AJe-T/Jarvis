import type { EventPayload } from '@shared/ipc-contract';
import type { UiToolCall } from '@shared/types';
import type { ToolRuntime, TurnContext } from '../agent/agent-loop';
import type { AssistantStateHub } from '../agent/assistant-state';
import { toUiToolCall, type ToolCallRow, type ToolCallsRepo } from '../db/repos/tool-calls-repo';
import { JarvisError, errorMessage } from '../errors';
import { nowIso, truncate } from '../lib/util';
import type { Logger } from '../logging/logger';
import type { ToolResultBlockParam, ToolUseBlock } from '../llm/types';
import type { AuditLog } from '../security/audit';
import type { PolicyEngine } from '../security/policy-engine';
import { redact, redactDeep } from '../security/redact';
import { wrapUntrusted } from '../security/untrusted';
import type { ConfirmationBroker } from './confirmation-broker';
import type { ToolRegistry } from './registry';
import type { Tool, ToolContent, ToolOutput } from './types';

export const DECLINED_TEXT = "Sir declined this action. Do not retry it; ask what he'd prefer.";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESULT_TEXT = 20 * 1024;
const PREVIEW = 2 * 1024;

export interface ExecutorDeps {
  registry: ToolRegistry;
  policy: PolicyEngine;
  broker: ConfirmationBroker;
  toolCalls: ToolCallsRepo;
  audit: AuditLog;
  state: AssistantStateHub;
  emit(event: 'tool:update', payload: EventPayload<'tool:update'>): void;
  logger: Logger;
}

function result(
  block: ToolUseBlock,
  content: NonNullable<ToolResultBlockParam['content']>,
  isError: boolean,
): ToolResultBlockParam {
  const toolset = (block as { toolset_name?: string | null }).toolset_name;
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content,
    ...(isError ? { is_error: true } : {}),
    ...(toolset ? { toolset_name: toolset } : {}),
  };
}

function textOf(content: ToolContent[]): string {
  return content.map((c) => (c.type === 'text' ? c.text : '[image]')).join('\n');
}

async function runWithTimeout(
  tool: Tool,
  input: unknown,
  ctx: TurnContext,
  logger: Logger,
): Promise<ToolOutput> {
  const timeoutMs = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_r, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new JarvisError('TOOL_TIMEOUT', `Timed out after ${Math.round(timeoutMs / 1000)} s.`),
        ),
      timeoutMs + 250,
    );
  });
  const stopped = new Promise<never>((_r, reject) => {
    ctx.signal.addEventListener(
      'abort',
      () => reject(new JarvisError('KILLED', 'Stopped by Sir.')),
      { once: true },
    );
  });
  try {
    return await Promise.race([
      tool.run(input, {
        signal,
        conversationId: ctx.conversationId,
        turnId: ctx.turnId,
        tainted: ctx.taint.tainted,
        logger,
      }),
      timeout,
      stopped,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** API-Guide.md §3.4: policy → confirmation → run (timeout/abort) → audit → tool_result. */
export function createToolExecutor(deps: ExecutorDeps): ToolRuntime {
  const log = deps.logger.child({ module: 'tools.executor' });

  function publish(ctx: TurnContext, row: ToolCallRow, over: Partial<UiToolCall> = {}): void {
    deps.emit('tool:update', {
      turnId: ctx.turnId,
      conversationId: ctx.conversationId,
      toolCall: { ...toUiToolCall(row), ...over },
    });
  }

  async function execute(block: ToolUseBlock, ctx: TurnContext): Promise<ToolResultBlockParam> {
    const tool = deps.registry.get(block.name);
    if (!tool) return result(block, `Unknown tool "${block.name}".`, true);

    const parsed = tool.input.safeParse(block.input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ');
      return result(
        block,
        `Invalid input for ${tool.name}: ${issues}. Fix the input and try again.`,
        true,
      );
    }
    const input = parsed.data;
    const decision = deps.policy.evaluate(tool, input, {
      signal: ctx.signal,
      tainted: ctx.taint.tainted,
    });
    const inputJson = truncate(JSON.stringify(redactDeep(input), null, 2), PREVIEW);
    let row = deps.toolCalls.create({
      conversationId: ctx.conversationId,
      toolUseId: block.id,
      toolName: tool.name,
      toolsetName: (block as { toolset_name?: string | null }).toolset_name ?? null,
      source: tool.source ?? 'native',
      inputJson,
      humanSummary: decision.humanSummary,
      tier: decision.tier,
      decision:
        decision.tier === 'SAFE' ? 'auto' : decision.tier === 'BLOCKED' ? 'blocked' : 'cancelled',
      decidedBy: decision.tier === 'CONFIRM' ? null : 'policy',
      status: decision.tier === 'BLOCKED' ? 'not_run' : 'pending',
    });
    // Security.md §5: decisions are written to the audit log before execution.
    deps.audit.append('agent', 'tool.decision', {
      tool: tool.name,
      tier: decision.tier,
      reason: decision.reason,
      summary: decision.humanSummary,
      toolUseId: block.id,
    });
    publish(ctx, row);

    if (decision.tier === 'BLOCKED') {
      log.info({ tool: tool.name, reason: decision.reason }, 'tool blocked');
      return result(
        block,
        `This action is not permitted by Jarvis's safety policy (${decision.reason}).`,
        true,
      );
    }

    if (decision.tier === 'CONFIRM') {
      deps.state.set('AWAITING_CONFIRMATION');
      publish(ctx, row, { status: 'awaiting' });
      const extra = tool.confirm?.(input) ?? {};
      const answer = await deps.broker.request(
        {
          toolName: tool.name,
          title: extra.title ?? `${decision.humanSummary}?`,
          humanSummary: decision.humanSummary,
          purpose: extra.purpose,
          details: extra.details ?? inputJson,
          detailsKind: extra.detailsKind ?? 'code',
          actionLabel: extra.actionLabel ?? decision.humanSummary,
          destructive: decision.destructive,
          taintedFrom: ctx.taint.tainted ? (ctx.taint.source ?? 'external content') : undefined,
        },
        ctx.signal,
      );
      deps.audit.append(
        answer.decidedBy === 'user_click' || answer.decidedBy === 'user_voice' ? 'user' : 'system',
        'tool.confirmation',
        {
          tool: tool.name,
          decision: answer.decision,
          decidedBy: answer.decidedBy,
          toolUseId: block.id,
        },
      );
      if (answer.decision === 'deny') {
        row = deps.toolCalls.update(row.id, {
          decision: 'denied',
          decided_by: answer.decidedBy,
          status: 'not_run',
        });
        publish(ctx, row);
        deps.state.set('THINKING');
        const text =
          answer.decidedBy === 'kill_switch'
            ? 'Not executed: Sir stopped all activity.'
            : answer.decidedBy === 'timeout'
              ? 'Sir did not respond within 2 minutes, so this was not done. Ask before trying again.'
              : DECLINED_TEXT;
        return result(block, text, true);
      }
      row = deps.toolCalls.update(row.id, { decision: 'approved', decided_by: answer.decidedBy });
    }

    deps.state.set('ACTING');
    const started = Date.now();
    row = deps.toolCalls.update(row.id, { status: 'running', started_at: nowIso() });
    publish(ctx, row);

    let output: ToolOutput;
    try {
      output = await runWithTimeout(tool, input, ctx, log);
    } catch (err) {
      const msg =
        err instanceof JarvisError
          ? (err.userMessage ?? err.message)
          : `${tool.name} failed: ${errorMessage(err)}`;
      output = { content: [{ type: 'text', text: msg }], isError: true };
    }

    const untrusted = !output.isError && (output.untrusted ?? tool.untrustedOutput ?? false);
    const source = output.untrustedSource ?? `${tool.source ?? 'native'}:${tool.name}`;
    const content: ToolContent[] = output.content.map((c) =>
      c.type === 'text'
        ? {
            type: 'text',
            text: truncate(untrusted ? wrapUntrusted(c.text, source) : c.text, MAX_RESULT_TEXT),
          }
        : c,
    );
    if (untrusted) {
      ctx.taint.tainted = true;
      ctx.taint.source ??= source;
    }
    const plain = textOf(output.content);
    row = deps.toolCalls.update(row.id, {
      status: output.isError ? 'error' : 'success',
      output_preview: truncate(redact(plain), PREVIEW),
      error: output.isError ? truncate(redact(plain), 500) : null,
      untrusted_output: untrusted ? 1 : 0,
      finished_at: nowIso(),
      duration_ms: Date.now() - started,
    });
    deps.audit.append('agent', 'tool.result', {
      tool: tool.name,
      status: row.status,
      durationMs: row.duration_ms,
      toolUseId: block.id,
    });
    publish(ctx, row);
    deps.state.set('THINKING');
    log.info(
      { tool: tool.name, tier: decision.tier, status: row.status, durationMs: row.duration_ms },
      'tool executed',
    );
    return result(block, content, output.isError === true);
  }

  return {
    definitions: () => deps.registry.definitions(),
    execute,
    isBatchToolset: (block) => Boolean((block as { toolset_name?: string | null }).toolset_name),
  };
}
