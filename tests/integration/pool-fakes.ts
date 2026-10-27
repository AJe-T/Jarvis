import { setupServices } from './helpers';

/** Fake free-AI provider servers for the AI Router tests (no real keys, no network). */

export const sse = (text: string): Response =>
  new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 12 } })}`,
      'data: [DONE]',
      '',
    ].join('\n\n'),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

export type Reply = (url: string) => Response;

export function setup(reply: Reply, script: Parameters<typeof setupServices>[0] = { rules: [] }) {
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

export const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
export const CEREBRAS = 'https://api.cerebras.ai/v1/chat/completions';
export const rateLimited = (): Response =>
  new Response('{"error":"rate limit"}', { status: 429, headers: { 'retry-after': '30' } });
