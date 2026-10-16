import { z } from 'zod';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import { MAX_ATTENDEES, MAX_ROUNDS, memoryPath, type NpcRuntime } from './npc-runtime';
import type { NpcRepo } from './npc-repo';

/** Jarvis as head of the NPC team: see who is there, give them work, read their memory, call meetings. */
export function createNpcTools(runtime: NpcRuntime, repo: NpcRepo): Tool[] {
  const Names = z.array(z.string().min(1).max(24)).min(1).max(MAX_ATTENDEES);
  return [
    defineTool({
      name: 'npc_team',
      description:
        "Lists Sir's NPCs (his team of single-purpose agents you lead): name, role, AI, tools, on/off and what each is doing. Use before giving them work or when Sir asks about his team.",
      input: z.object({}),
      tier: 'SAFE',
      summarize: () => 'Check the NPC team',
      async run() {
        const states = runtime.states();
        const team = repo.list();
        if (team.length === 0) return ok('Sir has no NPCs yet (Sidebar → NPCs to add some).');
        return ok(
          team
            .map(
              (n) =>
                `- ${n.name} (${n.role}) · ${n.brain} · ${states[n.id] ?? 'idle'} · tools: ${n.tools.join(', ') || 'none'}`,
            )
            .join('\n'),
        );
      },
    }),
    defineTool({
      name: 'npc_ask',
      description:
        "Give a job to one or more of Sir's NPCs by name; they work in parallel (each with its own AI, tools and memory) and their replies come back to you. The request is posted in the office chat so Sir sees it. Use when a job fits an NPC's role or Sir names one. Put everything they need in the task.",
      input: z.object({ npcs: Names, task: z.string().min(5).max(6000) }),
      tier: 'SAFE',
      timeoutMs: 15 * 60_000,
      summarize: ({ npcs, task }) => `Ask ${npcs.join(', ')}: ${task.slice(0, 60)}`,
      async run({ npcs, task }, ctx) {
        try {
          const replies = await runtime.assign(npcs, task, ctx.tainted);
          const tainted = replies.some((r) => r.reply.tainted);
          return {
            content: [
              {
                type: 'text',
                text: replies
                  .map((r) => `## ${r.npc.name} (${r.npc.role})\n${r.reply.text}`)
                  .join('\n\n'),
              },
            ],
            ...(tainted
              ? { untrusted: true, untrustedSource: 'NPCs who read outside content' }
              : {}),
          };
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    }),
    defineTool({
      name: 'npc_memory',
      description:
        "Reads one NPC's memory note (the facts it chose to keep). You can read every NPC's memory; they can't read each other's.",
      input: z.object({ npc: z.string().min(1).max(24) }),
      tier: 'SAFE',
      // Facts an NPC wrote may come from pages it read: data, never instructions.
      untrustedOutput: true,
      summarize: ({ npc }) => `Read ${npc}'s memory`,
      async run({ npc }) {
        const n = repo.list().find((x) => x.name.toLowerCase() === npc.trim().toLowerCase());
        if (!n) return fail(`No NPC called ${npc}.`);
        const text = await runtime.memory(n);
        return ok(text ? `${memoryPath(n)}:\n${text}` : `${n.name} hasn't kept any memories yet.`);
      },
    }),
    defineTool({
      name: 'npc_meeting',
      description: `Calls a meeting of 1–${MAX_ATTENDEES} NPCs on a topic: they talk in turns for 1–${MAX_ROUNDS} rounds, then you post a summary with action items (saved to the vault). Runs in the background; Sir watches it in NPCs → Meeting room.`,
      input: z.object({
        topic: z.string().min(3).max(300),
        npcs: Names,
        rounds: z.number().int().min(1).max(MAX_ROUNDS).default(2),
      }),
      tier: 'SAFE',
      summarize: ({ topic }) => `Meeting: ${topic.slice(0, 70)}`,
      async run({ topic, npcs, rounds }, ctx) {
        const team = repo.list().filter((n) => n.enabled);
        const ids = npcs
          .map((name) => team.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.id)
          .filter((id): id is string => Boolean(id));
        if (ids.length === 0) return fail(`None of those NPCs are switched on.`);
        const m = await runtime.startMeeting(topic, ids, rounds, ctx.tainted);
        return ok(
          `Meeting ${m.id} started with ${ids.length} NPC(s). The summary will be posted when it ends.`,
        );
      },
    }),
  ];
}
