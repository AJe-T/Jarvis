import { describe, expect, it } from 'vitest';
import { runOnBrain } from '@main/agent/brain-runner';
import { createSubagentTool } from '@main/agent/subagents';
import { JarvisError } from '@main/errors';
import { POOL_TOOLS } from '@shared/free-pool';
import { idle, setupServices } from './helpers';

/** AI Router Phase 1: the free pool behind brain "free", against fake provider servers. */

const sse = (text: string): Response =>
  new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 12 } })}`,
      'data: [DONE]',
      '',
    ].join('\n\n'),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

type Reply = (url: string) => Response;

function setup(reply: Reply, script: Parameters<typeof setupServices>[0] = { rules: [] }) {
  const calls: string[] = [];
  const bodies: Array<{ tools?: Array<{ function: { name: string } }> }> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body === 'string')
      bodies.push(JSON.parse(init.body) as (typeof bodies)[number]);
    const url = input instanceof Request ? input.url : input.toString();
    calls.push(url);
    return reply(url);
  }) as typeof globalThis.fetch;
  const t = setupServices(script, { fetch });
  const s = t.services;
  s.secrets.set('groq', 'gsk_test_groq_key_0000');
  s.connections.setModel('conn_groq', 'llama-3.3-70b-versatile');
  s.secrets.set('cerebras', 'csk-test-cerebras-0000');
  s.connections.setModel('conn_cerebras', 'gpt-oss-120b');
  // Groq first in Priority, so the failover is deterministic.
  s.settings.set('pool.strategy', 'priority');
  s.settings.set('pool.models', {
    'llama-3.3-70b-versatile': { order: 0 },
    'gpt-oss-120b': { order: 1 },
  });
  return { ...t, calls, bodies };
}

const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const CEREBRAS = 'https://api.cerebras.ai/v1/chat/completions';
const rateLimited = (): Response =>
  new Response('{"error":"rate limit"}', { status: 429, headers: { 'retry-after': '30' } });

const request = {
  model: 'pool',
  max_tokens: 200,
  messages: [{ role: 'user' as const, content: 'Summarise the history of tea in one line.' }],
};

describe('free AI pool', () => {
  it('fails over from a rate-limited provider to the next, pauses the first, answers for free', async () => {
    const t = setup((url) => (url === GROQ ? rateLimited() : sse('Tea came from China.')));
    const s = t.services;
    const session = s.pool.session({ id: 'job1', task: 'Tea history' });
    const msg = await session.stream(request, { signal: new AbortController().signal });

    expect(t.calls).toEqual([GROQ, CEREBRAS]);
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Tea came from China.' });
    expect(msg.id.startsWith('pool_conn_cerebras_')).toBe(true);
    expect(session.trail.attempts).toEqual([
      {
        provider: 'groq',
        name: 'Groq',
        model: 'llama-3.3-70b-versatile',
        tier: 2,
        ok: false,
        reason: 'rate limited',
      },
      { provider: 'cerebras', name: 'Cerebras', model: 'gpt-oss-120b', tier: 2, ok: true },
    ]);

    const snap = s.pool.snapshot();
    expect(snap.recent[0]).toMatchObject({
      task: 'Tea history',
      providerId: 'cerebras',
      tried: [{ providerId: 'groq', reason: 'rate limited' }],
    });
    expect(snap.pressure.map((p) => p.providerId)).toEqual(['groq']);
    expect(snap.today.requests).toBe(1);
    expect(snap.preview).toBe(false);

    // Paused for its retry-after: the next request goes straight to Cerebras.
    await s.pool.session({ id: 'job2', task: 'again' }).stream(request, {
      signal: new AbortController().signal,
    });
    expect(t.calls.slice(2)).toEqual([CEREBRAS]);

    // Free in the usage ledger, marked as the pool.
    const used = s.ledger.record(msg, 'task', null);
    expect(used.costUsd).toBe(0);
  });

  it('says plainly why nothing could answer, and asks before a third-party AI', async () => {
    const t = setup((url) => (url === GROQ ? sse('From the relay.') : rateLimited()));
    const s = t.services;
    s.settings.set('pool.providers', { groq: { tier: 3 } });

    const first = s.pool
      .session({ id: 'job3', task: 'x' })
      .stream(request, { signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 20));
    const ask = t.events.find((e) => e.event === 'pool:ask')?.payload as { requestId: string };
    expect(ask?.requestId).toBeTruthy();
    s.answerTier3(ask.requestId, 'no');
    const err = await first.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JarvisError);
    expect((err as JarvisError).userMessage).toMatch(
      /^All free AIs are busy: .*Claude can do this one instead\.$/,
    );
    expect(t.calls).not.toContain(GROQ);

    // "Just this once": the third-party route answers.
    const second = s.pool
      .session({ id: 'job4', task: 'y' })
      .stream(request, { signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 20));
    const ask2 = t.events.filter((e) => e.event === 'pool:ask')[1]?.payload as {
      requestId: string;
    };
    s.answerTier3(ask2.requestId, 'once');
    expect((await second).content[0]).toMatchObject({ text: 'From the relay.' });
  });

  it('a tier-3 answer gets only the question and taints the turn like a web page', async () => {
    const t = setup((url) => (url === GROQ ? sse('From the relay.') : rateLimited()));
    const s = t.services;
    s.settings.set('pool.providers', { groq: { tier: 3 } });
    const turn = {
      turnId: 't1',
      conversationId: 'c1',
      mode: 'text' as const,
      purpose: 'task' as const,
      signal: new AbortController().signal,
      taint: { tainted: false } as { tainted: boolean; source?: string },
    };
    const run = runOnBrain(s, 'free', {
      system: 'You are a sub-agent of JARVIS.',
      prompt: 'What does drift mean?',
      tools: s.tools,
      maxSteps: 2,
      maxTokens: 200,
      turn,
    });
    await new Promise((r) => setTimeout(r, 20));
    const ask = t.events.find((e) => e.event === 'pool:ask')?.payload as { requestId: string };
    s.answerTier3(ask.requestId, 'once');
    const result = await run;

    expect(result.text).toContain('(Free pool: answered by Groq, a third-party AI');
    expect(turn.taint).toEqual({ tainted: true, source: 'a third-party AI (tier 3)' });
    const sent = t.bodies.at(-1) as unknown as { tools?: unknown; messages: unknown };
    expect(sent.tools).toBeUndefined();
    expect(sent.messages).toEqual([
      { role: 'system', content: 'Answer the question clearly and briefly.' },
      { role: 'user', content: 'What does drift mean?' },
    ]);
  });

  it('never gets a task from a turn that read private data, or that carries a secret', async () => {
    const t = setup(() => sse('should never run'));
    const s = t.services;
    const job = (prompt: string, privateSource?: string) => ({
      system: 'sub-agent',
      prompt,
      tools: s.tools,
      maxSteps: 2,
      maxTokens: 200,
      turn: {
        turnId: 't1',
        conversationId: 'c1',
        mode: 'text' as const,
        purpose: 'task' as const,
        signal: new AbortController().signal,
        taint: { tainted: false, ...(privateSource ? { privateSource } : {}) },
      },
    });
    await expect(
      runOnBrain(s, 'free', job('Summarise my notes', 'Memory and the vault')),
    ).rejects.toMatchObject({
      code: 'POLICY_BLOCKED',
    });
    await expect(
      runOnBrain(
        s,
        'free',
        job('Use the key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
    expect(t.calls).toHaveLength(0);
  });

  it('Claude hands a sub-task to the free pool and reads who answered', async () => {
    const t = setup(
      (url) => (url === GROQ ? rateLimited() : sse('RESULT: done\nTea came from China.')),
      {
        rules: [
          {
            match: 'tea for me',
            steps: [
              {
                tools: [
                  {
                    name: 'delegate_task',
                    input: {
                      tasks: [
                        {
                          title: 'Tea history',
                          instructions: 'Summarise the history of tea in one line.',
                          brain: 'free',
                        },
                      ],
                    },
                  },
                ],
              },
              { text: 'Done, sir.' },
            ],
          },
        ],
      },
    );
    const s = t.services;
    s.registry.register(createSubagentTool(s));
    s.orchestrator.send({ text: 'look up tea for me', source: 'text' });
    await idle(s, 10_000);
    // Every call Claude got after delegating (later calls are titles and memory).
    const report = JSON.stringify(t.llm.calls.map((c) => c.messages));
    expect(report).toContain('Tea came from China.');
    expect(report).toContain(
      '(Free pool: answered by Cerebras · gpt-oss-120b; tried Groq: rate limited.)',
    );
    // The pool's sub-agent is offered public lookups only, never file, screen or memory tools.
    const offered = new Set(t.bodies.flatMap((b) => (b.tools ?? []).map((x) => x.function.name)));
    expect(offered.size).toBeGreaterThan(0);
    for (const name of offered) expect(POOL_TOOLS.has(name), name).toBe(true);
  });

  it('an earlier turn that read private data closes the pool for the whole conversation', async () => {
    const t = setup(() => sse('should never run'), {
      rules: [
        {
          match: 'my reminders',
          steps: [{ tools: [{ name: 'list_reminders', input: {} }] }, { text: 'None, sir.' }],
        },
        {
          match: 'now summarise',
          steps: [
            {
              tools: [
                {
                  name: 'delegate_task',
                  input: {
                    tasks: [
                      {
                        title: 'Sum',
                        instructions: 'Summarise the reminders above.',
                        brain: 'free',
                      },
                    ],
                  },
                },
              ],
            },
            { text: 'Ok.' },
          ],
        },
      ],
    });
    const s = t.services;
    s.registry.register(createSubagentTool(s));
    const { conversationId } = s.orchestrator.send({
      text: 'what are my reminders',
      source: 'text',
    });
    await idle(s, 10_000);
    s.orchestrator.send({ conversationId, text: 'now summarise them', source: 'text' });
    await idle(s, 10_000);
    expect(JSON.stringify(t.llm.calls.map((c) => c.messages))).toContain(
      'earlier in this conversation',
    );
    expect(t.calls).toHaveLength(0);
  });

  it('a turn that read Sir’s reminders can no longer use the free pool', async () => {
    const t = setup(() => sse('should never run'), {
      rules: [
        {
          match: 'clipboard job',
          steps: [
            { tools: [{ name: 'list_reminders', input: {} }] },
            {
              tools: [
                {
                  name: 'delegate_task',
                  input: {
                    tasks: [
                      {
                        title: 'Rewrite',
                        instructions: 'Rewrite the clipboard text nicely.',
                        brain: 'free',
                      },
                    ],
                  },
                },
              ],
            },
            { text: 'Could not, sir.' },
          ],
        },
      ],
    });
    const s = t.services;
    s.registry.register(createSubagentTool(s));
    s.orchestrator.send({ text: 'clipboard job please', source: 'text' });
    await idle(s, 10_000);
    expect(JSON.stringify(t.llm.calls.map((c) => c.messages))).toContain('Free AIs never get');
    expect(t.calls).toHaveLength(0);
  });
});
