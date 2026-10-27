import { describe, expect, it } from 'vitest';
import { createSubagentTool } from '@main/agent/subagents';
import type { LlmRequest } from '@main/llm/types';
import { POOL_TOOLS } from '@shared/free-pool';
import { idle } from './helpers';
import { CEREBRAS, GROQ, rateLimited, setup, sse } from './pool-fakes';

/** AI Router Phase 2: front door, sticky models, hand-over note, fallbacks, delegation switch. */

type T = ReturnType<typeof setup>;
type Body = { messages: Array<{ role: string; content: string }>; tools?: unknown[] };

const sys = (c: LlmRequest): string =>
  typeof c.system === 'string' ? c.system : (c.system ?? []).map((b) => b.text).join('\n');
/** Claude's chat calls (titles, memory and summaries are background jobs). */
const chatCalls = (t: T): LlmRequest[] =>
  t.llm.calls.filter((c) => !/word title|long-term memory|Summarise the earlier/i.test(sys(c)));
const notices = (t: T): string[] =>
  t.events
    .filter((e) => e.event === 'chat:message')
    .map((e) => (e.payload as { message: { role: string; text: string } }).message)
    .filter((m) => m.role === 'notice')
    .map((m) => m.text);
const bodies = (t: T): Body[] => t.bodies as unknown as Body[];

async function ask(t: T, text: string, conversationId?: string): Promise<string> {
  const sent = t.services.orchestrator.send({
    text,
    source: 'text',
    ...(conversationId ? { conversationId } : {}),
  });
  await idle(t.services, 10_000);
  return sent.conversationId;
}

const lastReply = (t: T, id: string) =>
  t.services.conversations
    .messages(id)
    .filter((m) => m.role === 'assistant')
    .at(-1);

describe('front door', () => {
  it('sends a simple public question to a tier-2 free AI, says so, and Claude is never asked', async () => {
    const t = setup(() => sse('Paris.'));
    t.services.settings.set('pool.delegation.frontDoor', true);
    const id = await ask(t, 'What is the capital of France?');

    expect(t.calls).toEqual([GROQ]);
    expect(chatCalls(t)).toHaveLength(0);
    const reply = lastReply(t, id);
    expect(reply?.model).toBe('pool:llama-3.3-70b-versatile');
    expect(reply?.text_plain).toBe(
      'Paris.\n\n(Free pool: answered by Groq · llama-3.3-70b-versatile.)',
    );
    expect(notices(t)).toEqual([
      "Front door: a free AI answered this simple question, so Claude wasn't used.",
    ]);
    // A neutral prompt: nothing about Sir; public lookup tools only.
    const body = bodies(t)[0] as Body;
    expect(body.messages[0]?.content).toMatch(/^You are JARVIS, a helpful assistant/);
    expect(body.messages.at(-1)).toEqual({
      role: 'user',
      content: 'What is the capital of France?',
    });
    const offered = (body.tools ?? []) as Array<{ function: { name: string } }>;
    for (const x of offered) expect(POOL_TOOLS.has(x.function.name), x.function.name).toBe(true);
  });

  it('is off by default, and never takes personal, long or private chats', async () => {
    const t = setup(() => sse('never'));
    await ask(t, 'What is the capital of France?');
    t.services.settings.set('pool.delegation.frontDoor', true);
    await ask(t, 'What is on my calendar today?');
    await ask(t, '/private What is the capital of France?');
    await ask(t, 'What is sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA used for?');
    expect(t.calls).toHaveLength(0);
    expect(chatCalls(t)).toHaveLength(4);
  });

  it('a private tool call anywhere in the chat closes the front door', async () => {
    const t = setup(() => sse('Paris.'));
    const s = t.services;
    s.settings.set('pool.delegation.frontDoor', true);
    const id = await ask(t, 'What is the capital of France?');
    expect(t.calls).toHaveLength(1);
    // Sir's reminders read in this conversation (e.g. by an automation or a sub-agent).
    await s.tools.execute(
      { type: 'tool_use', id: 'toolu_r1', name: 'list_reminders', input: {} } as never,
      {
        turnId: 't_x',
        conversationId: id,
        mode: 'text',
        purpose: 'chat',
        signal: new AbortController().signal,
        taint: { tainted: false },
      },
    );
    await ask(t, 'What is the capital of Spain?', id);
    expect(t.calls).toHaveLength(1);
    expect(chatCalls(t)).toHaveLength(1);
  });

  it('after Claude answered, a follow-up stays with Claude (his reply may hold memories)', async () => {
    const t = setup(() => sse('never'));
    const id = await ask(t, 'Tell me a story about the sea, please, a long one.');
    t.services.settings.set('pool.delegation.frontDoor', true);
    await ask(t, 'Why is it blue?', id);
    expect(t.calls).toHaveLength(0);
    expect(chatCalls(t)).toHaveLength(2);
  });

  it('a message sent while the turn waited is not part of it', async () => {
    const t = setup(() => sse('Paris.'));
    const s = t.services;
    s.settings.set('pool.delegation.frontDoor', true);
    const { conversationId } = s.orchestrator.send({
      text: 'What is the capital of France?',
      source: 'text',
    });
    s.orchestrator.send({ conversationId, text: 'Here is a long note about tea.', source: 'text' });
    await idle(s, 10_000);
    expect(t.calls).toEqual([GROQ]);
    expect(bodies(t)[0]?.messages.slice(1)).toEqual([
      { role: 'user', content: 'What is the capital of France?' },
    ]);
  });

  it('every free AI busy: Claude answers and the chat says so', async () => {
    const t = setup(() => rateLimited());
    t.services.settings.set('pool.delegation.frontDoor', true);
    const id = await ask(t, 'What is the capital of France?');
    expect(t.calls).toEqual([GROQ, CEREBRAS]);
    expect(chatCalls(t)).toHaveLength(1);
    expect(lastReply(t, id)?.text_plain).toBe('Echo: What is the capital of France?');
    expect(notices(t)).toEqual(['The free AIs were busy, so Claude answered.']);
  });
});

describe('sticky conversations and the hand-over note', () => {
  /** Groq is rate limited the first time only; Cerebras always answers. */
  function flaky(sticky: boolean): T {
    let groq = 0;
    const t = setup((url) => (url === GROQ && groq++ === 0 ? rateLimited() : sse('Paris.')));
    t.services.settings.set('pool.delegation.frontDoor', true);
    t.services.settings.set('pool.delegation.sticky', sticky);
    return t;
  }

  it('keeps a chat on the model that answered it', async () => {
    const t = flaky(true);
    const id = await ask(t, 'What is the capital of France?');
    expect(t.calls).toEqual([GROQ, CEREBRAS]);
    t.services.pool.clearCooldowns(); // Groq is back and first in Priority...
    await ask(t, 'What is the capital of Spain?', id);
    expect(t.calls.slice(2)).toEqual([CEREBRAS]); // ...but the chat stays on Cerebras.
  });

  it('with sticky off, the usual order applies', async () => {
    const t = flaky(false);
    const id = await ask(t, 'What is the capital of France?');
    t.services.pool.clearCooldowns();
    await ask(t, 'What is the capital of Spain?', id);
    expect(t.calls.slice(2)).toEqual([GROQ]);
  });

  function switching(handover: boolean): T {
    let groq = 0;
    const t = setup((url) => (url === GROQ && groq++ > 0 ? rateLimited() : sse('Paris.')));
    t.services.settings.set('pool.delegation.frontDoor', true);
    t.services.settings.set('pool.delegation.handover', handover);
    return t;
  }

  it('the same model sees the free AIs’ earlier exchange; the next one gets a short note', async () => {
    const t = switching(true);
    const id = await ask(t, 'What is the capital of France?');
    await ask(t, 'And of Germany?', id);
    expect(t.calls).toEqual([GROQ, GROQ, CEREBRAS]);
    const [, toGroq, toCerebras] = bodies(t);
    expect(toGroq?.messages.slice(1)).toEqual([
      { role: 'user', content: 'What is the capital of France?' },
      { role: 'assistant', content: 'Paris.' },
      { role: 'user', content: 'And of Germany?' },
    ]);
    expect(toCerebras?.messages.slice(1)).toEqual([
      {
        role: 'user',
        content:
          'Hand-over note: another AI answered earlier in this chat.\nQ: What is the capital of France?\nA: Paris.\n\nCurrent question: And of Germany?',
      },
    ]);
  });

  it('with the note off, the next model gets the question alone', async () => {
    const t = switching(false);
    const id = await ask(t, 'What is the capital of France?');
    await ask(t, 'And of Germany?', id);
    expect(bodies(t)[2]?.messages.slice(1)).toEqual([{ role: 'user', content: 'And of Germany?' }]);
  });
});

describe('fallback both ways', () => {
  it('Claude out of budget: a free AI answers a non-private chat, visibly', async () => {
    const t = setup(() => sse('Sunlight bends in raindrops.'));
    t.services.settings.set('budget.dailyUsd', 0);
    const id = await ask(t, 'Explain how rainbows form.');
    expect(t.calls).toEqual([GROQ]);
    expect(lastReply(t, id)?.text_plain).toContain('(Free pool: answered by Groq');
    expect(notices(t)).toEqual([
      "Today's budget ($0.00) is used up. Adjust it in Settings → Brain. A free AI answered instead of Claude.",
    ]);
  });

  it('never for a private chat, a personal question, or a chat that read private data', async () => {
    const t = setup(() => sse('never'));
    const s = t.services;
    const id = await ask(t, 'Remind me what my reminders are, run list now.');
    // The reminders were read in this conversation by a tool: the pool stays shut here.
    await s.tools.execute(
      { type: 'tool_use', id: 'toolu_r2', name: 'list_reminders', input: {} } as never,
      {
        turnId: 't_y',
        conversationId: id,
        mode: 'text',
        purpose: 'chat',
        signal: new AbortController().signal,
        taint: { tainted: false },
      },
    );
    s.settings.set('budget.dailyUsd', 0);
    await ask(t, '/private Explain how rainbows form.');
    await ask(t, 'What should I cook for my mother tonight?');
    await ask(t, 'Explain how rainbows form.', id);
    expect(t.calls).toHaveLength(0);
    expect(notices(t).filter((n) => n.includes('budget'))).toHaveLength(3);
  });

  it('a third-party AI taking over gets only the current question, never the hand-over note', async () => {
    let groq = 0;
    const t = setup((url) => (url === GROQ && groq++ > 0 ? rateLimited() : sse('Paris.')));
    const s = t.services;
    s.settings.set('pool.delegation.frontDoor', true);
    const id = await ask(t, 'What is the capital of France?');
    s.settings.set('pool.delegation.frontDoor', false);
    s.settings.set('pool.providers', { cerebras: { tier: 3 } });
    s.settings.set('budget.dailyUsd', 0);
    const sent = s.orchestrator.send({
      conversationId: id,
      text: 'And of Germany?',
      source: 'text',
    });
    await new Promise((r) => setTimeout(r, 100));
    const q = t.events.find((e) => e.event === 'pool:ask')?.payload as { requestId: string };
    s.answerTier3(q.requestId, 'once');
    await idle(s, 10_000);
    expect(sent.conversationId).toBe(id);
    expect(t.calls).toEqual([GROQ, GROQ, CEREBRAS]);
    expect(bodies(t)[2]?.messages).toEqual([
      { role: 'system', content: 'Answer the question clearly and briefly.' },
      { role: 'user', content: 'And of Germany?' },
    ]);
  });

  it('switched off: Claude’s error stands', async () => {
    const t = setup(() => sse('never'));
    t.services.settings.set('pool.delegation.fallback', false);
    t.services.settings.set('budget.dailyUsd', 0);
    await ask(t, 'Explain how rainbows form.');
    expect(t.calls).toHaveLength(0);
  });
});

describe('delegate_task to brain "free"', () => {
  const delegating = {
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
  };

  it('every free AI busy: Claude does the sub-task itself and the report says so', async () => {
    const t = setup(() => rateLimited(), delegating);
    t.services.registry.register(createSubagentTool(t.services));
    await ask(t, 'look up tea for me');
    expect(t.calls).toEqual([GROQ, CEREBRAS]);
    const report = JSON.stringify(t.llm.calls.map((c) => c.messages));
    expect(report).toContain('(Free pool busy, so Claude did this one.)');
  });

  it('switched off: brain "free" is refused before anything is sent', async () => {
    const t = setup(() => sse('never'), delegating);
    t.services.settings.set('pool.delegation.delegate', false);
    t.services.registry.register(createSubagentTool(t.services));
    await ask(t, 'look up tea for me');
    expect(t.calls).toHaveLength(0);
    expect(JSON.stringify(t.llm.calls.map((c) => c.messages))).toContain(
      'Sir switched off handing work to free AIs',
    );
  });
});
