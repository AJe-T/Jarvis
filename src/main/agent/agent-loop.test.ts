import { describe, expect, it } from 'vitest';
import type { NewMessage } from '../db/repos/conversations-repo';
import { createFakeClaude, type FakeScript } from '../llm/fake-claude';
import type { ToolResultBlockParam, ToolUseBlock } from '../llm/types';
import { HALT_TEXT, runAgentLoop, type ToolRuntime, type TurnContext } from './agent-loop';

const budget = { assertCanSpend: () => undefined, isExceeded: () => false };
const ledger = {
  record: () => ({ costUsd: 0, inputTokens: 100, outputTokens: 1 }),
  totals: () => ({ day: 0, month: 0 }),
  priceFor: () => ({}),
} as never;

function tools(
  behaviour: (b: ToolUseBlock) => Partial<ToolResultBlockParam> = () => ({}),
  batch = false,
) {
  const executed: string[] = [];
  const runtime: ToolRuntime = {
    definitions: () => [],
    isBatchToolset: () => batch,
    async execute(block) {
      executed.push(block.name);
      return { type: 'tool_result', tool_use_id: block.id, content: 'ok', ...behaviour(block) };
    },
  };
  return { runtime, executed };
}

function ctx(signal = new AbortController().signal): TurnContext {
  return {
    turnId: 't',
    conversationId: 'c',
    mode: 'text',
    purpose: 'chat',
    signal,
    taint: { tainted: false },
  };
}

async function run(
  script: FakeScript,
  runtime: ToolRuntime,
  opts: { max?: number; signal?: AbortSignal } = {},
) {
  const persisted: NewMessage[] = [];
  const llm = createFakeClaude(script);
  const result = await runAgentLoop(
    { llm, tools: runtime, budget, ledger, maxIterations: opts.max ?? 25 },
    ctx(opts.signal),
    { model: 'm', system: [], messages: [{ role: 'user', content: 'go' }] },
    { onText: () => undefined, persist: (m) => persisted.push(...m) },
  );
  return { result, persisted, llm };
}

const twoTools: FakeScript = {
  rules: [
    {
      match: 'go',
      steps: [
        {
          text: 'Working.',
          tools: [
            { name: 'a', input: {} },
            { name: 'b', input: {} },
          ],
        },
        { text: 'Done.' },
      ],
    },
  ],
};

describe('agent loop', () => {
  it('answers every tool_use with exactly one tool_result, in order', async () => {
    const { runtime, executed } = tools();
    const { result, persisted, llm } = await run(twoTools, runtime);
    expect(result.outcome).toBe('end_turn');
    expect(executed).toEqual(['a', 'b']);
    const second = llm.calls[1];
    const last = second?.messages.at(-1);
    const results = (last?.content as ToolResultBlockParam[]).map((r) => r.tool_use_id);
    const uses = (second?.messages.at(-2)?.content as ToolUseBlock[])
      .filter((b) => b.type === 'tool_use')
      .map((b) => b.id);
    expect(results).toEqual(uses);
    expect(persisted.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
  });

  it('halts the rest of a toolset batch after a failure', async () => {
    const { runtime, executed } = tools((b) => (b.name === 'a' ? { is_error: true } : {}), true);
    const { llm } = await run(twoTools, runtime);
    expect(executed).toEqual(['a']);
    const results = llm.calls[1]?.messages.at(-1)?.content as ToolResultBlockParam[];
    expect(results[1]?.content).toBe(HALT_TEXT);
    expect(results[1]?.is_error).toBe(true);
  });

  it('keeps running independent native tools after one fails', async () => {
    const { runtime, executed } = tools((b) => (b.name === 'a' ? { is_error: true } : {}), false);
    await run(twoTools, runtime);
    expect(executed).toEqual(['a', 'b']);
  });

  it('stops at the iteration cap with a message', async () => {
    const loop: FakeScript = {
      rules: [{ match: 'go', steps: [{ tools: [{ name: 'a', input: {} }] }] }],
    };
    const { runtime, executed } = tools();
    const { result } = await run(loop, runtime, { max: 3 });
    expect(result.outcome).toBe('max_iterations');
    expect(executed).toHaveLength(3);
    expect(result.text).toMatch(/stopped after 3 steps/);
  });

  it('stops immediately when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { runtime, executed } = tools();
    const { result } = await run(twoTools, runtime, { signal: controller.signal });
    expect(result.outcome).toBe('aborted');
    expect(executed).toHaveLength(0);
  });

  it('persists partial text as interrupted when aborted mid-stream', async () => {
    const controller = new AbortController();
    const slow: FakeScript = {
      rules: [
        {
          match: 'go',
          steps: [{ text: 'A long answer that keeps going and going.', chunkDelayMs: 20 }],
        },
      ],
    };
    const persisted: NewMessage[] = [];
    setTimeout(() => controller.abort(), 30);
    const result = await runAgentLoop(
      { llm: createFakeClaude(slow), tools: tools().runtime, budget, ledger, maxIterations: 5 },
      ctx(controller.signal),
      { model: 'm', system: [], messages: [{ role: 'user', content: 'go' }] },
      { onText: () => undefined, persist: (m) => persisted.push(...m) },
    );
    expect(result.outcome).toBe('aborted');
    expect(persisted[0]?.stopReason).toBe('interrupted');
  });

  it('returns declined results to Claude as errors', async () => {
    const { runtime } = tools(() => ({
      is_error: true,
      content: "Sir declined this action. Do not retry it; ask what he'd prefer.",
    }));
    const { llm } = await run(twoTools, runtime);
    const results = llm.calls[1]?.messages.at(-1)?.content as ToolResultBlockParam[];
    expect(results[0]?.content).toMatch(/declined/);
  });

  it('checks the budget before every Claude call', async () => {
    let calls = 0;
    const strict = {
      assertCanSpend: () => {
        calls++;
        if (calls > 1) throw new Error('budget');
      },
      isExceeded: () => false,
    };
    await expect(
      runAgentLoop(
        {
          llm: createFakeClaude(twoTools),
          tools: tools().runtime,
          budget: strict,
          ledger,
          maxIterations: 5,
        },
        ctx(),
        { model: 'm', system: [], messages: [{ role: 'user', content: 'go' }] },
        { onText: () => undefined, persist: () => undefined },
      ),
    ).rejects.toThrow('budget');
  });
});
