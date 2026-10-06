import { describe, expect, it } from 'vitest';
import { localDay } from '@main/lib/util';
import { idle, setupServices } from './helpers';

/** A scripted Ollama: answers /models and streams /chat/completions as Server-Sent Events. */
function fakeOllama(replies: Array<Array<Record<string, unknown>>>, seen: unknown[]) {
  let i = 0;
  return (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'qwen3:8b' }] });
    seen.push(JSON.parse(init?.body as string));
    const chunks = replies[Math.min(i++, replies.length - 1)] ?? [];
    const sse = [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), 'data: [DONE]\n\n'].join(
      '',
    );
    return new Response(new TextEncoder().encode(sse), {
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
}

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ delta: d, finish_reason: finish }],
});

describe('local model connection end to end (ADR-013)', () => {
  it('runs a tool turn through Ollama with the normal agent loop; usage is free', async () => {
    const seen: unknown[] = [];
    const fetch = fakeOllama(
      [
        [
          delta({ content: '<think>need the clock</think>' }),
          delta({
            tool_calls: [
              { index: 0, id: 'call_a', function: { name: 'get_datetime', arguments: '{}' } },
            ],
          }),
          delta({}, 'tool_calls'),
          { choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } },
        ],
        [delta({ content: "It's " }), delta({ content: 'half past nine, sir.' }, 'stop')],
      ],
      seen,
    );
    const t = setupServices(undefined, { fetch });
    const s = t.services;
    s.settings.set('llm.provider', 'local');
    s.settings.set('llm.local.model', 'qwen3:8b');
    s.settings.set('budget.dailyUsd', 0); // irrelevant for a local model
    const deltas: string[] = [];
    s.orchestrator.onDelta((_turn, d) => deltas.push(d));
    const { conversationId } = s.orchestrator.send({ text: 'what time is it', source: 'text' });
    await idle(s);

    expect(deltas.join('')).toBe("It's half past nine, sir.");
    expect(s.toolCalls.list(5).map((r) => `${r.tool_name}:${r.status}`)).toEqual([
      'get_datetime:success',
    ]);
    const texts = s.conversations.messages(conversationId).map((m) => m.text_plain);
    expect(texts.at(-1)).toBe("It's half past nine, sir.");
    const first = seen[0] as { model: string; tools: Array<{ function: { name: string } }> };
    expect(first.model).toBe('qwen3:8b');
    expect(first.tools.some((x) => x.function.name === 'get_datetime')).toBe(true);
    expect(first.tools.some((x) => x.function.name === 'web_search')).toBe(false);
    const second = seen[1] as { messages: Array<{ role: string }> };
    expect(second.messages.map((m) => m.role)).toContain('tool');
    expect(s.usageRepo.totals(localDay(), localDay(), 'local').tokens).toBeGreaterThan(0);
    expect(s.usageRepo.totals(localDay(), localDay()).costUsd).toBe(0);
    expect(t.llm.calls).toHaveLength(0);
  });

  it('lists models and tests the chosen one', async () => {
    const t = setupServices(undefined, { fetch: fakeOllama([], []) });
    expect(await t.services.llmLocal.listModels()).toEqual(['qwen3:8b']);
    t.services.settings.set('llm.local.model', 'llama3.1:8b');
    await expect(t.services.llmLocal.ping('', AbortSignal.timeout(1000))).rejects.toMatchObject({
      userMessage: /doesn't have "llama3.1:8b"/,
    });
  });
});
