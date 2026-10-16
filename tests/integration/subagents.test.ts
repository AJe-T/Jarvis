import { describe, expect, it } from 'vitest';
import { createSubagentTool } from '@main/agent/subagents';
import { idle, setupServices } from './helpers';

describe('sub-agents (idea from LibreChat)', () => {
  it('runs jobs side by side in fresh contexts, limited to their tools, and reports back', async () => {
    const t = setupServices({
      rules: [
        {
          system: 'sub-agent of JARVIS',
          match: 'Task 1 of 2',
          steps: [
            { tools: [{ name: 'get_datetime', input: {} }] },
            { text: 'RESULT: done\nIt is the test clock time.' },
          ],
        },
        {
          system: 'sub-agent of JARVIS',
          match: 'Task 2 of 2',
          steps: [
            { tools: [{ name: 'open_app', input: { name: 'notepad' } }] },
            { text: 'RESULT: failed\nopen_app was not available.' },
          ],
        },
        {
          match: 'split this up',
          steps: [
            {
              tools: [
                {
                  name: 'delegate_task',
                  input: {
                    tasks: [
                      { title: 'Clock', instructions: 'Find out the current date and time.' },
                      {
                        title: 'Notepad',
                        instructions: 'Open notepad for sir please.',
                        tools: ['get_datetime', 'delegate_task'],
                      },
                    ],
                    shared_context: 'Sir is testing sub-agents.',
                  },
                },
              ],
            },
            { text: 'Both sub-agents reported back, sir.' },
          ],
        },
      ],
    });
    const s = t.services;
    s.registry.register(createSubagentTool(s));
    s.orchestrator.send({ text: 'split this up please', source: 'text' });
    await idle(s, 10_000);

    const sub = t.llm.calls.filter((c) => JSON.stringify(c.system).includes('sub-agent of JARVIS'));
    expect(sub).toHaveLength(4);
    // Fresh context: only the task and the shared background, never the chat.
    const first = JSON.stringify(sub[0]?.messages);
    expect(first).toContain('Sir is testing sub-agents.');
    expect(first).not.toContain('split this up');
    // No recursion: delegate_task is never offered, even when named.
    for (const c of sub)
      expect((c.tools ?? []).map((d) => (d as { name: string }).name)).not.toContain(
        'delegate_task',
      );
    const restricted = sub.find((c) => JSON.stringify(c.messages).includes('Task 2 of 2'));
    expect((restricted?.tools ?? []).map((d) => (d as { name: string }).name)).toEqual([
      'get_datetime',
    ]);

    const calls = s.toolCalls.list(20).map((r) => r.tool_name);
    expect(calls).toContain('get_datetime');
    expect(calls).not.toContain('open_app');

    const main = t.llm.calls
      .filter((c) => JSON.stringify(c.system).includes('personal AI assistant running'))
      .at(-1);
    const report = JSON.stringify(main?.messages.at(-1)?.content);
    expect(report).toContain('Sub-agent 1: Clock (done)');
    expect(report).toContain('Sub-agent 2: Notepad (failed)');
    const purposes = (
      s.db.prepare('SELECT DISTINCT purpose FROM usage_ledger').all() as Array<{ purpose: string }>
    ).map((p) => p.purpose);
    expect(purposes).toContain('task');
  });

  it('hands a task to another AI Sir set up (Gemini), billed, and refuses one that is not set up', async () => {
    const sent: string[] = [];
    const fetchFake = (async (url: string, init?: RequestInit) => {
      sent.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
      const ev = (e: object): string => `data: ${JSON.stringify(e)}\n\n`;
      return new Response(
        ev({ choices: [{ delta: { content: 'RESULT: done\nGemini says hello.' } }] }) +
          ev({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }) +
          'data: [DONE]\n\n',
      );
    }) as typeof fetch;
    const ask = (brain: string) => ({
      match: `ask ${brain}`,
      steps: [
        {
          tools: [
            {
              name: 'delegate_task',
              input: {
                tasks: [{ title: 'Hello', instructions: 'Say hello to sir, please.', brain }],
              },
            },
          ],
        },
        { text: 'Done, sir.' },
      ],
    });
    const t = setupServices({ rules: [ask('gemini'), ask('deepseek')] }, { fetch: fetchFake });
    const s = t.services;
    s.registry.register(createSubagentTool(s));
    s.secrets.set('gemini', 'AIza-test');
    s.settings.set('llm.cloud.models', { gemini: 'gemini-flash' });

    s.orchestrator.send({ text: 'ask gemini', source: 'text' });
    await idle(s, 10_000);
    expect(sent[0]).toContain('generativelanguage.googleapis.com');
    expect(sent[0]).toContain('"model":"gemini-flash"');
    const lastReport = (): string =>
      JSON.stringify(
        t.llm.calls
          .filter((c) => JSON.stringify(c.system).includes('personal AI assistant running'))
          .at(-1)
          ?.messages.at(-1)?.content,
      );
    expect(lastReport()).toContain('by Google Gemini');
    expect(lastReport()).toContain('Gemini says hello.');
    const billed = s.db
      .prepare(`SELECT billing FROM usage_ledger WHERE model = 'gemini-flash'`)
      .all() as Array<{ billing: string }>;
    expect(billed.map((b) => b.billing)).toEqual(['api']);

    s.orchestrator.send({ text: 'ask deepseek', source: 'text' });
    await idle(s, 10_000);
    expect(lastReport()).toContain('DeepSeek is not set up');
    expect(sent).toHaveLength(1);
  });
});
