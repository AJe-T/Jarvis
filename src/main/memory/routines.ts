import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MemoryRepos, RoutineRow } from '../db/repos/memory-repos';
import { newId } from '../lib/util';
import type { ToolRuntime, TurnContext } from '../agent/agent-loop';
import type { ToolRegistry } from '../tools/registry';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import { describeStep, type BrowserTrail } from '../apps/browser-trail';
import { parseNote, stringifyNote } from './frontmatter';
import type { VaultService } from './vault-service';

const RoutineSchema = z.object({
  name: z.string().min(1).max(80),
  triggers: z.array(z.string().min(2).max(100)).max(20).default([]),
  enabled: z.boolean().default(true),
  steps: z
    .array(
      z.object({ tool: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) }),
    )
    .min(1)
    .max(30),
});
type Step = { tool: string; input: Record<string, unknown> };

/** Tools a routine must never chain (no recursion, no unattended shell/computer control). */
const FORBIDDEN_IN_ROUTINES = new Set([
  'run_routine',
  'run_powershell',
  'delegate_desktop_task',
  'memory',
]);

/** Database.md §8.4: Routines/*.md → routines table. Invalid routines are disabled with an error shown in Settings. */
export async function loadRoutines(
  vault: VaultService,
  repos: MemoryRepos,
  registry: ToolRegistry,
): Promise<void> {
  const rows: Array<Omit<RoutineRow, 'id' | 'last_run_at'>> = [];
  const files = (await vault.walk('Routines').catch(() => [])).filter((f) =>
    f.toLowerCase().endsWith('.md'),
  );
  for (const rel of files) {
    const { frontmatter } = parseNote(await readFile(vault.resolve(rel), 'utf8'));
    const parsed = RoutineSchema.safeParse({
      ...frontmatter,
      name: frontmatter['name'] ?? rel.replace(/^Routines\//, '').replace(/\.md$/, ''),
    });
    if (!parsed.success) {
      rows.push({
        name: rel,
        vault_path: rel,
        trigger_phrases_json: '[]',
        steps_json: '[]',
        enabled: 0,
        error: parsed.error.issues[0]?.message ?? 'Invalid routine',
      });
      continue;
    }
    let error = routineStepsError(parsed.data.steps, registry);
    // routines.name is UNIQUE: a duplicate is stored under its path so one bad file can't fail the whole load.
    const duplicate = rows.some((r) => r.name.toLowerCase() === parsed.data.name.toLowerCase());
    if (duplicate) error = `Duplicate routine name "${parsed.data.name}"`;
    rows.push({
      name: duplicate ? rel : parsed.data.name,
      vault_path: rel,
      trigger_phrases_json: JSON.stringify(parsed.data.triggers),
      steps_json: JSON.stringify(parsed.data.steps),
      enabled: parsed.data.enabled && !error ? 1 : 0,
      error,
    });
  }
  repos.routines.replaceAll(rows);
}

/** A routine step that waits for Sir's OK (idea from ruflo's workflow approval gates). */
export const CHECKPOINT_TOOL = 'ask_to_continue';

/**
 * Browser recipes (idea from ruflo's browser plugin): what Jarvis just did in Jarvis Browser becomes a
 * routine note. Each step finds its control by name when it runs and is checked by the policy again.
 */
export function createBrowserRoutineTool(vault: VaultService, trail: BrowserTrail): Tool {
  const RoutineName = z
    .string()
    .min(2)
    .max(60)
    .regex(/^[\w\- ]+$/, 'letters, numbers, spaces and dashes only');
  return defineTool({
    name: 'save_browser_routine',
    description:
      'Save what you just did in Jarvis Browser in this conversation (the pages opened, clicks, choices and typing that worked) as one of sir\'s routines, so it can run again by name or trigger phrase ("save that as my electricity bill routine"). Only when sir asks. Each step finds its control by name when it runs; clicks that send, buy or submit still ask him.',
    input: z.object({
      name: RoutineName,
      triggers: z.array(z.string().min(2).max(100)).max(5).default([]),
    }),
    tier: 'CONFIRM',
    summarize: ({ name }) => `Save browser routine "${name}"`,
    confirm: ({ name }) => {
      const steps = trail.mostRecent()?.steps ?? [];
      return {
        title: `Save these steps as the routine "${name}"?`,
        actionLabel: 'Save routine',
        details: steps.length
          ? steps.map((s, i) => `${i + 1}. ${describeStep(s)}`).join('\n')
          : 'No browser steps yet.',
        detailsKind: 'text',
      };
    },
    async run({ name, triggers }, ctx) {
      const latest = trail.mostRecent();
      if (!latest?.steps.length)
        return fail('Nothing done in Jarvis Browser in this conversation yet.');
      // What sir approved was the latest browser trail: refuse if that was another conversation's.
      if (latest.conversationId !== ctx.conversationId)
        return fail('The browser was used in another conversation since; ask again here.');
      const rel = `Routines/${name.trim()}.md`;
      if (vault.exists(rel)) return fail(`A routine called "${name}" already exists.`);
      const note = stringifyNote(
        { kind: 'routine', name: name.trim(), triggers, enabled: true, steps: latest.steps },
        `# ${name.trim()}\n\nSaved from Jarvis Browser on ${new Date().toLocaleDateString('en-GB')}. Each step finds its control by name when it runs; clicks that send, buy or submit still ask.\n`,
      );
      await vault.write(rel, note);
      return ok(
        `Saved "${name}" with ${latest.steps.length} steps (${rel}). Run it with run_routine${triggers.length ? ` or say "${triggers[0]}"` : ''}.`,
      );
    },
  });
}

/** Why these steps cannot be a routine, or null when every step names a real tool with valid input. */
export function routineStepsError(steps: Step[], registry: ToolRegistry): string | null {
  for (const [i, s] of steps.entries()) {
    const tool = registry.get(s.tool);
    if (!tool) return `Step ${i + 1}: unknown tool "${s.tool}"`;
    if (FORBIDDEN_IN_ROUTINES.has(s.tool))
      return `Step ${i + 1}: ${s.tool} cannot be used in a routine`;
    const r = tool.input.safeParse(s.input);
    if (!r.success)
      return `Step ${i + 1} (${s.tool}): ${r.error.issues[0]?.message ?? 'invalid input'}`;
  }
  return null;
}

/**
 * save_routine (2.73, teach by showing): steps Jarvis wrote himself, usually from what he saw
 * after watch_me, become a routine note. Sir sees every step before it is saved, and each step
 * still goes through the policy when the routine runs.
 */
export function createSaveRoutineTool(vault: VaultService, registry: ToolRegistry): Tool {
  const describe = (s: Step): string => {
    const input = JSON.stringify(s.input);
    return `${s.tool}${input === '{}' ? '' : ` ${input.length > 140 ? `${input.slice(0, 140)}…` : input}`}`;
  };
  return defineTool({
    name: 'save_routine',
    description:
      'Save a list of tool steps as one of sir\'s routines, so it runs again by name or trigger phrase. Use after stop_watching ("save that as my morning setup") or when sir dictates the steps. Each step is one of your tools with its input, e.g. open_app, focus_window, click_ui_element, open_url, set_volume, ask_to_continue (a pause where sir must do something himself). Not run_powershell or computer control. Sir sees every step before it is saved.',
    input: z.object({
      name: z
        .string()
        .min(2)
        .max(60)
        .regex(/^[\w\- ]+$/, 'letters, numbers, spaces and dashes only'),
      triggers: z.array(z.string().min(2).max(100)).max(5).default([]),
      steps: z
        .array(
          z.object({
            tool: z.string().min(1),
            input: z.record(z.string(), z.unknown()).default({}),
          }),
        )
        .min(1)
        .max(30),
    }),
    tier: 'CONFIRM',
    summarize: ({ name, steps }) => `Save routine "${name}" (${steps.length} steps)`,
    confirm: ({ name, steps }) => ({
      title: `Save these steps as the routine "${name}"?`,
      actionLabel: 'Save routine',
      details: steps.map((s, i) => `${i + 1}. ${describe(s)}`).join('\n'),
      detailsKind: 'text',
    }),
    async run({ name, triggers, steps }) {
      const error = routineStepsError(steps, registry);
      if (error) return fail(`${error}. Fix that step and try again.`);
      const rel = `Routines/${name.trim()}.md`;
      if (vault.exists(rel)) return fail(`A routine called "${name}" already exists.`);
      const note = stringifyNote(
        { kind: 'routine', name: name.trim(), triggers, enabled: true, steps },
        `# ${name.trim()}\n\nSaved by Jarvis on ${new Date().toLocaleDateString('en-GB')}. Each step is checked by the safety policy when it runs.\n`,
      );
      await vault.write(rel, note);
      return ok(
        `Saved "${name}" with ${steps.length} steps (${rel}). Run it with run_routine${triggers.length ? ` or say "${triggers[0]}"` : ''}.`,
      );
    },
  });
}

/** list_routines / run_routine (Security.md §4.1: SAFE to start; each step goes through the policy itself). */
export function createRoutineTools(repos: MemoryRepos, runtime: () => ToolRuntime): Tool[] {
  return [
    defineTool({
      name: CHECKPOINT_TOOL,
      description:
        'A checkpoint step for routines: pauses and asks sir whether to go on. If he says no, the routine stops there. Not for ordinary questions (just ask those in your reply).',
      input: z.object({ message: z.string().min(2).max(200) }),
      tier: 'CONFIRM',
      summarize: ({ message }) => message,
      confirm: ({ message }) => ({
        title: message,
        actionLabel: 'Continue',
        details: 'The routine waits here until you say go. Cancel stops it.',
        detailsKind: 'text',
      }),
      run: async () => ok('Sir said to continue.'),
    }),
    defineTool({
      name: 'list_routines',
      description:
        "List sir's routines (named multi-step workflows stored in Obsidian) with their trigger phrases.",
      input: z.object({}).strict(),
      tier: 'SAFE',
      summarize: () => 'List routines',
      async run() {
        const all = repos.routines.all();
        if (all.length === 0)
          return ok('No routines yet. Sir can add Markdown notes to the Routines folder.');
        return ok(
          all
            .map(
              (r) =>
                `${r.name}${r.enabled ? '' : ` (disabled: ${r.error ?? 'off'})`} — triggers: ${(JSON.parse(r.trigger_phrases_json) as string[]).join(', ')}`,
            )
            .join('\n'),
        );
      },
    }),
    defineTool({
      name: 'run_routine',
      description:
        'Run one of sir\'s routines by name (e.g. "Work Mode" for "start work mode"). Each step is checked and confirmed on its own.',
      input: z.object({ name: z.string().min(1).max(80) }),
      tier: 'SAFE',
      timeoutMs: 15 * 60_000,
      summarize: ({ name }) => `Run routine "${name}"`,
      async run({ name }, ctx) {
        const r = repos.routines.byName(name);
        if (!r) return fail(`No routine called "${name}". Use list_routines to see them.`);
        if (!r.enabled)
          return fail(`Routine "${r.name}" is disabled${r.error ? `: ${r.error}` : ''}.`);
        repos.routines.markRun(r.id);
        const steps = JSON.parse(r.steps_json) as Step[];
        const turn: TurnContext = {
          turnId: ctx.turnId,
          conversationId: ctx.conversationId,
          mode: 'text',
          purpose: 'chat',
          signal: ctx.signal,
          taint: { tainted: ctx.tainted },
        };
        const lines: string[] = [];
        for (const [i, s] of steps.entries()) {
          if (ctx.signal.aborted) break;
          const res = await runtime().execute(
            {
              type: 'tool_use',
              id: `toolu_routine_${newId()}`,
              name: s.tool,
              input: s.input,
              caller: { type: 'direct' },
            } as never,
            turn,
          );
          const text =
            typeof res.content === 'string'
              ? res.content
              : (res.content ?? []).map((c) => ('text' in c ? c.text : '')).join(' ');
          lines.push(`${i + 1}. ${s.tool}: ${res.is_error ? '✗' : '✓'} ${text.slice(0, 200)}`);
          if (s.tool === CHECKPOINT_TOOL && res.is_error) {
            lines.push(`Stopped at step ${i + 1}: sir did not want to continue.`);
            break;
          }
        }
        return ok(`Routine "${r.name}":\n${lines.join('\n')}`);
      },
    }),
  ];
}
