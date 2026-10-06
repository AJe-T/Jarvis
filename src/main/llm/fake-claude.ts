import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { sleep } from '../lib/util';
import type { LlmClient, LlmMessage, LlmRequest, MessageParam } from './types';

// Testing.md §2: JARVIS_TEST=1 uses this scripted stand-in for Claude. Rules are matched against the
// latest user text; the step index is the number of assistant messages already sent after it.

const StepSchema = z.object({
  text: z.string().optional(),
  tools: z
    .array(z.object({ name: z.string(), input: z.record(z.string(), z.unknown()) }))
    .optional(),
  chunkDelayMs: z.number().optional(),
});
const RuleSchema = z.object({
  match: z.string().optional(),
  system: z.string().optional(),
  steps: z.array(StepSchema).min(1),
});
export const FakeScriptSchema = z.object({ rules: z.array(RuleSchema) });
export type FakeScript = z.infer<typeof FakeScriptSchema>;
type Step = z.infer<typeof StepSchema>;

function isUserText(m: MessageParam): boolean {
  if (m.role !== 'user') return false;
  if (typeof m.content === 'string') return true;
  return m.content.some((b) => b.type === 'text');
}

function textOf(m: MessageParam): string {
  if (typeof m.content === 'string') return m.content;
  return m.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ');
}

function systemText(req: LlmRequest): string {
  if (!req.system) return '';
  return typeof req.system === 'string' ? req.system : req.system.map((b) => b.text).join('\n');
}

const DEFAULTS: Array<{ system: RegExp; text: string }> = [
  { system: /word title for this conversation/i, text: 'Test conversation' },
  {
    system: /long-term memory of a personal assistant/i,
    text: '{"ops":[{"op":"NOOP"}],"flag":null}',
  },
  { system: /Summarise the earlier part/i, text: 'Earlier, sir and the assistant chatted.' },
];

export function createFakeClaude(
  script: FakeScript = { rules: [] },
): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let idCounter = 0;

  function pick(req: LlmRequest): Step {
    const sys = systemText(req);
    const lastUserIdx = req.messages.map(isUserText).lastIndexOf(true);
    const lastUser = lastUserIdx >= 0 ? textOf(req.messages[lastUserIdx] as MessageParam) : '';
    const stepIdx = req.messages
      .slice(lastUserIdx + 1)
      .filter((m) => m.role === 'assistant').length;
    const background = DEFAULTS.some((d) => d.system.test(sys));
    for (const rule of script.rules) {
      // Chat rules never answer background jobs (titles, curator, summaries) unless they ask to.
      if (!rule.system && background) continue;
      if (rule.system && !new RegExp(rule.system, 'i').test(sys)) continue;
      if (rule.match && !new RegExp(rule.match, 'i').test(lastUser)) continue;
      if (!rule.system && !rule.match) continue;
      return rule.steps[Math.min(stepIdx, rule.steps.length - 1)] as Step;
    }
    const def = DEFAULTS.find((d) => d.system.test(sys));
    if (def) return { text: def.text };
    return { text: stepIdx === 0 ? `Echo: ${lastUser}` : 'Done, sir.' };
  }

  return {
    calls,
    async stream(req, opts) {
      calls.push(req);
      const step = pick(req);
      const content: Array<Record<string, unknown>> = [];
      const text = step.text ?? '';
      if (text) {
        for (let i = 0; i < text.length; i += 8) {
          if (opts.signal.aborted)
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          opts.onText?.(text.slice(i, i + 8));
          if (step.chunkDelayMs) await sleep(step.chunkDelayMs, opts.signal).catch(() => undefined);
        }
        if (opts.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        content.push({ type: 'text', text, citations: null });
      }
      for (const t of step.tools ?? []) {
        idCounter += 1;
        content.push({
          type: 'tool_use',
          id: `toolu_fake_${idCounter}`,
          name: t.name,
          input: t.input,
          caller: { type: 'direct' },
        });
      }
      // Test double: only the fields the app reads are populated.
      return {
        id: `msg_fake_${idCounter++}`,
        type: 'message',
        role: 'assistant',
        model: req.model,
        content,
        stop_reason: step.tools?.length ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: Math.ceil(text.length / 4) + 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          server_tool_use: null,
        },
      } as unknown as LlmMessage;
    },
    async ping() {
      /* always succeeds */
    },
  };
}

export function loadFakeScript(path: string | undefined): FakeScript {
  if (!path) return { rules: [] };
  return FakeScriptSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
