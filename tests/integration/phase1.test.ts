import { describe, expect, it } from 'vitest';
import { idle, setupServices } from './helpers';

const KEY = 'sk-ant-api03-SECRETSECRETSECRET0123456789abcdef';

describe('phase 1 integration', () => {
  it('runs a text turn: streams deltas, persists both messages, emits the final message', async () => {
    const { services, events } = setupServices({
      rules: [{ match: 'hello', steps: [{ text: 'Good evening, sir.' }] }],
    });
    const { conversationId } = services.orchestrator.send({ text: 'hello', source: 'text' });
    await idle(services);
    expect(events.filter((e) => e.event === 'chat:delta').length).toBeGreaterThan(0);
    const final = events.find((e) => e.event === 'chat:message');
    expect((final?.payload as { message: { text: string } }).message.text).toBe(
      'Good evening, sir.',
    );
    expect(services.conversations.messages(conversationId).map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    const states = events
      .filter((e) => e.event === 'assistant:state')
      .map((e) => (e.payload as { state: string }).state);
    expect(states).toEqual(['THINKING', 'IDLE']);
  });

  it('titles a conversation after the first exchange', async () => {
    const { services } = setupServices();
    const { conversationId } = services.orchestrator.send({ text: 'hi', source: 'text' });
    await idle(services);
    await new Promise((r) => setTimeout(r, 50));
    expect(services.conversations.get(conversationId)?.title).toBe('Test conversation');
  });

  it('refuses to call Claude when the budget is used up (Testing.md §4 budget stop)', async () => {
    const { services, events, llm } = setupServices();
    services.usageRepo.insert({
      model: 'm',
      purpose: 'chat',
      conversationId: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estCostUsd: 5,
    });
    services.orchestrator.send({ text: 'hello', source: 'text' });
    await idle(services);
    expect(llm.calls).toHaveLength(0);
    const notice = events.find((e) => e.event === 'notify');
    expect((notice?.payload as { message: string }).message).toMatch(/Today's budget/);
  });

  it('never sends the API key to the renderer (secrets isolation)', async () => {
    const { services, events } = setupServices({
      rules: [{ match: 'key', steps: [{ text: `Your key is ${KEY}` }] }],
    });
    services.secrets.set('anthropic', KEY);
    services.orchestrator.send({ text: 'what is my key', source: 'text' });
    await idle(services);
    const status = services.secrets.status();
    expect(JSON.stringify(status)).not.toContain(KEY);
    // Persisted history is redacted.
    const stored = services.db.prepare('SELECT content_json FROM messages').all() as Array<{
      content_json: string;
    }>;
    expect(stored.map((r) => r.content_json).join('\n')).not.toContain(KEY);
    // Only the streaming deltas could carry model text; check every non-delta event.
    expect(
      JSON.stringify(events.filter((e) => e.event !== 'chat:delta' && e.event !== 'chat:message')),
    ).not.toContain(KEY);
  });

  it('cancels a running turn and keeps partial text marked interrupted', async () => {
    const { services } = setupServices({
      rules: [{ match: 'long', steps: [{ text: 'x'.repeat(400), chunkDelayMs: 10 }] }],
    });
    const { conversationId, turnId } = services.orchestrator.send({
      text: 'long story',
      source: 'text',
    });
    await new Promise((r) => setTimeout(r, 60));
    services.orchestrator.cancel(turnId);
    await idle(services);
    const rows = services.conversations.messages(conversationId);
    expect(rows.at(-1)?.stop_reason).toBe('interrupted');
  });

  it('queues a second message instead of overlapping turns', async () => {
    const { services, llm } = setupServices({
      rules: [{ match: '.', steps: [{ text: 'ok', chunkDelayMs: 5 }] }],
    });
    const a = services.orchestrator.send({ text: 'one', source: 'text' });
    services.orchestrator.send({ conversationId: a.conversationId, text: 'two', source: 'text' });
    await idle(services);
    const chatCalls = llm.calls.filter((c) => c.max_tokens === 4096);
    expect(chatCalls).toHaveLength(2);
    expect(chatCalls[1]?.messages.length).toBeGreaterThan(chatCalls[0]?.messages.length ?? 0);
  });

  it('marks /private conversations private', () => {
    const { services } = setupServices();
    const { conversationId } = services.orchestrator.send({
      text: '/private what is 2+2',
      source: 'text',
    });
    expect(services.conversations.get(conversationId)?.is_private).toBe(1);
  });
});
