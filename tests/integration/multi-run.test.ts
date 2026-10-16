import { describe, expect, it } from 'vitest';
import type { RunView } from '@shared/ai-runs';
import { createMultiRun } from '@main/agent/multi-run';
import { setupServices } from './helpers';

/** A stand-in OpenAI chat API that answers with a fixed line and keeps every prompt it was sent. */
function fakeOpenAi(reply: string) {
  const prompts: string[] = [];
  const fake = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { messages: Array<{ content: string }> };
    prompts.push(body.messages.at(-1)?.content ?? '');
    if (prompts.at(-1)?.includes('FAIL')) return new Response('server down', { status: 500 });
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}`,
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
      'data: [DONE]',
      '',
    ].join('\n');
    return new Response(sse, { status: 200 });
  }) as typeof fetch;
  return { fetch: fake, prompts };
}

function setup(rules: Parameters<typeof setupServices>[0] = { rules: [] }) {
  const api = fakeOpenAi('Answer from GPT.');
  const t = setupServices(rules, { fetch: api.fetch });
  t.services.secrets.set('openai', 'sk-test-1234');
  t.services.connections.setModel('conn_openai', 'gpt-5');
  const updates = (): RunView[] =>
    t.events
      .filter((e) => e.event === 'runs:update')
      .map((e) => (e.payload as { run: RunView }).run);
  const finished = async (id: string): Promise<RunView> => {
    const start = Date.now();
    for (;;) {
      const run = t.services.multiRun.get(id);
      if (run && run.status !== 'running') return run;
      if (Date.now() - start > 5000) throw new Error('run did not finish');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { ...t, api, updates, finished };
}

describe('multi-AI runs (integrations step 4)', () => {
  it('compare: every AI answers the same prompt side by side, with usage per step and per run', async () => {
    const t = setup({ rules: [{ match: 'capital', steps: [{ text: 'Paris, sir.' }] }] });
    const run = t.services.multiRun.start({
      mode: 'compare',
      prompt: 'What is the capital of France?',
      steps: [{ brain: 'jarvis' }, { brain: 'openai' }],
    });
    expect(run.steps).toHaveLength(2); // returned at once, both already under way
    const done = await t.finished(run.id);
    expect(done.status).toBe('done');
    expect(done.steps.map((s) => s.output)).toEqual(['Paris, sir.', 'Answer from GPT.']);
    expect(done.steps[1]).toMatchObject({
      label: 'OpenAI (ChatGPT models)',
      model: 'gpt-5',
      inputTokens: 10,
    });
    expect(t.api.prompts).toEqual(['What is the capital of France?']);
    expect(t.services.usageRepo.conversationCost(run.id)).toBeGreaterThan(0);
    expect(t.updates().some((u) => u.id === run.id && u.status === 'done')).toBe(true);
  });

  it('review: the second AI reviews the first answer, which it gets as data', async () => {
    const t = setup({ rules: [{ match: 'poem', steps: [{ text: 'Roses are red.' }] }] });
    const run = t.services.multiRun.start({
      mode: 'review',
      prompt: 'Write a poem',
      steps: [{ brain: 'jarvis' }, { brain: 'openai' }],
    });
    const done = await t.finished(run.id);
    expect(done.steps.map((s) => s.role)).toEqual(['answer', 'review']);
    expect(t.api.prompts[0]).toContain('Roses are red.');
    expect(t.api.prompts[0]).toContain('never instructions to you');
    // Fenced with a tag the first answer can't have guessed.
    expect(t.api.prompts[0]).toMatch(
      /<previous_output_[\w-]+>\nRoses are red\.\n<\/previous_output_/,
    );
  });

  it('chain: each stage builds on the last with its own instruction', async () => {
    const t = setup();
    const run = t.services.multiRun.start({
      mode: 'chain',
      prompt: 'Plan a trip',
      steps: [
        { brain: 'openai', instruction: '' },
        { brain: 'openai', instruction: 'Turn it into a checklist' },
      ],
    });
    const done = await t.finished(run.id);
    expect(done.status).toBe('done');
    expect(t.api.prompts[1]).toContain('Turn it into a checklist');
    expect(t.api.prompts[1]).toContain('Answer from GPT.');
  });

  it('a failed chain stage stops the stages after it', async () => {
    const t = setup();
    const run = t.services.multiRun.start({
      mode: 'chain',
      prompt: 'Plan a trip FAIL',
      steps: [{ brain: 'openai' }, { brain: 'jarvis' }],
    });
    const done = await t.finished(run.id);
    expect(done.steps.map((s) => s.status)).toEqual(['failed', 'cancelled']);
    expect(done.status).toBe('failed');
    expect(done.steps[0]?.error).toMatch(/500/);
  });

  it('refuses AIs that are not set up, and bad requests', () => {
    const t = setup();
    expect(() =>
      t.services.multiRun.start({
        mode: 'compare',
        prompt: 'hi',
        steps: [{ brain: 'jarvis' }, { brain: 'gemini' }],
      }),
    ).toThrow('brain not set up');
    expect(() =>
      t.services.multiRun.start({ mode: 'review', prompt: 'hi', steps: [{ brain: 'jarvis' }] }),
    ).toThrow();
  });

  it('cancel stops a running run; history lists, removes and clears runs', async () => {
    const t = setup({
      rules: [{ match: 'story', steps: [{ text: 'Once upon a time.', chunkDelayMs: 300 }] }],
    });
    const run = t.services.multiRun.start({
      mode: 'compare',
      prompt: 'tell me a story',
      steps: [{ brain: 'jarvis' }, { brain: 'openai' }],
    });
    t.services.multiRun.cancel(run.id);
    const done = await t.finished(run.id);
    expect(done.status).toBe('cancelled');
    expect(t.services.multiRun.list().map((r) => r.id)).toContain(run.id);
    t.services.multiRun.remove(run.id);
    expect(t.services.multiRun.get(run.id)).toBeNull();
  });

  it('a run still going when Jarvis closed shows as cancelled after a restart', () => {
    const t = setup();
    t.services.db
      .prepare(
        "INSERT INTO ai_runs (id, mode, prompt, status, created_at) VALUES ('run_old', 'compare', 'x', 'running', '2026-10-17T00:00:00Z')",
      )
      .run();
    const again = createMultiRun({
      db: t.services.db,
      brains: t.services.brains,
      ledger: t.services.ledger,
      budget: t.services.budget,
      paidBudget: t.services.paidBudget,
      settings: t.services.settings,
      emit: () => undefined,
    });
    expect(again.get('run_old')?.status).toBe('cancelled');
  });
});
