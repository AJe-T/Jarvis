import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@main/tools/types';
import { idle, setupServices } from './helpers';

const BIG = [
  ...Array.from({ length: 800 }, (_, i) => `Row ${i}: ordinary log line, nothing to see.`),
  'ERROR disk quota exceeded on volume D',
  ...Array.from({ length: 200 }, (_, i) => `Row tail ${i}: ordinary log line.`),
].join('\n');

describe('saved tool outputs (idea from mksglu/context-mode)', () => {
  it('shows the start of a long result, then finds the rest by search, still wrapped as untrusted', async () => {
    const t = setupServices({
      rules: [
        {
          match: 'logs',
          steps: [
            { tools: [{ name: 'big_log', input: {} }] },
            { tools: [{ name: 'search_tool_output', input: { id: 'o1', query: 'disk quota' } }] },
            { text: 'Disk D is over quota, sir.' },
          ],
        },
      ],
    });
    t.services.registry.register(
      defineTool({
        name: 'big_log',
        description: 'Test tool with a long untrusted result.',
        input: z.object({}),
        tier: 'SAFE',
        untrustedOutput: true,
        summarize: () => 'Read big log',
        run: async () => ({ content: [{ type: 'text', text: BIG }] }),
      }),
    );
    t.services.orchestrator.send({ text: 'check the logs', source: 'text' });
    await idle(t.services);

    const chat = t.llm.calls.filter((c) => JSON.stringify(c.system).includes('You are JARVIS'));
    const first = JSON.stringify(chat[1]?.messages.at(-1)?.content);
    expect(first).toContain('Row 0:');
    expect(first).not.toContain('disk quota'); // beyond the preview
    expect(first).toContain('search_tool_output');
    expect(first.length).toBeLessThan(12_000);

    const second = JSON.stringify(chat[2]?.messages.at(-1)?.content);
    expect(second).toContain('ERROR disk quota exceeded on volume D');
    expect(second).toContain('untrusted_content');
    const rows = t.services.toolCalls.list(10).map((r) => `${r.tool_name}:${r.status}`);
    expect(rows).toContain('search_tool_output:success');
  });
});
