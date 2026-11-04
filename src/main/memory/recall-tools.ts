import { z } from 'zod';
import type { ToolCallRow } from '../db/repos/tool-calls-repo';
import type { MemoryRow } from '../db/repos/memory-repos';
import type { MessageHit } from '../db/repos/conversations-repo';
import { defineTool, fail, ok, type Tool } from '../tools/types';

/**
 * Three-step recall (idea from thedotmack/claude-mem's search → timeline → get_observations; our own
 * code). The context of each turn carries only a short index of matching notes; Claude reads the
 * full text of the ones it needs with memory_get, and recall_timeline shows what happened around a
 * day: notes changed, what was said, and what Jarvis did on the PC.
 */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-10-07.');
const NOTE_MAX = 6000;
const TOTAL_MAX = 24_000;
/** The timeline never lists its own calls (a recall would show up in the next recall). */
const SELF = new Set(['recall_timeline', 'memory_get']);

export interface RecallDeps {
  vault: { exists(rel: string): boolean; read(rel: string): Promise<{ body: string }> };
  notesChanged(fromIso: string, toIso: string, limit: number): MemoryRow[];
  messagesBetween(fromIso: string, toIso: string, limit: number): MessageHit[];
  actionsBetween(fromIso: string, toIso: string, limit: number): ToolCallRow[];
  /** Sir's local days (inclusive) → UTC instants, end exclusive. */
  dayRange(from?: string, to?: string): { from?: string; to?: string };
}

export interface TimelineEntry {
  at: string;
  kind: 'note' | 'chat' | 'action';
  text: string;
}

const STATUS: Record<string, string> = {
  success: 'done',
  error: 'failed',
  not_run: 'not run',
  pending: 'waiting',
  running: 'running',
};

/** One line per action: what it was, and how it ended (denied/blocked say so). */
export function actionLine(r: Pick<ToolCallRow, 'human_summary' | 'status' | 'decision'>): string {
  const how =
    r.decision === 'denied' || r.decision === 'blocked' || r.decision === 'cancelled'
      ? r.decision
      : (STATUS[r.status] ?? r.status);
  return `${r.human_summary} (${how})`;
}

/** Notes, chats and actions merged oldest first, local time "YYYY-MM-DD HH:MM". */
export function mergeTimeline(entries: TimelineEntry[], limit: number): string[] {
  const local = (iso: string): string => {
    const d = new Date(iso);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return [...entries]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-limit)
    .map((e) => `${local(e.at)} · ${e.kind} · ${e.text}`);
}

export function createRecallTools(d: RecallDeps): Tool[] {
  return [
    defineTool({
      name: 'memory_get',
      description:
        "Full text of memory notes by vault path (the paths shown in the memory index or by search_memory). The index only shows the start of each note: use this when the detail you need isn't there. Up to 8 paths at once; batch them.",
      input: z.object({
        paths: z.array(z.string().min(1).max(300)).min(1).max(8),
      }),
      tier: 'SAFE',
      summarize: ({ paths }) => `Read ${paths.length} memory note${paths.length === 1 ? '' : 's'}`,
      async run({ paths }) {
        const parts: string[] = [];
        let total = 0;
        for (const p of paths) {
          // Jarvis's own housekeeping (_jarvis/: templates, state) is not memory.
          if (!p.toLowerCase().endsWith('.md') || /^_jarvis[\\/]/i.test(p)) {
            parts.push(`## ${p}\n(not a note: only memory notes, .md)`);
            continue;
          }
          try {
            if (!d.vault.exists(p)) {
              parts.push(`## ${p}\n(no such note)`);
              continue;
            }
            const body = (await d.vault.read(p)).body.trim();
            const room = Math.max(0, Math.min(NOTE_MAX, TOTAL_MAX - total));
            const text = body.length > room ? `${body.slice(0, room)}…` : body;
            total += text.length;
            parts.push(`## ${p}\n${text || '(empty)'}`);
          } catch (err) {
            parts.push(`## ${p}\n(${err instanceof Error ? err.message : String(err)})`);
          }
        }
        return ok(parts.join('\n\n'));
      },
    }),
    defineTool({
      name: 'recall_timeline',
      description:
        "What happened on given days, oldest first: memory notes written or changed, what sir and Jarvis said, and the actions Jarvis took on the PC (with how each ended). Use for 'what did you do on my PC yesterday', 'what happened around the time we talked about X' (find the date with search_conversations first). Dates are sir's local days, YYYY-MM-DD, inclusive.",
      input: z.object({
        from: isoDay,
        to: isoDay.optional(),
        include: z
          .array(z.enum(['notes', 'chats', 'actions']))
          .min(1)
          .default(['notes', 'chats', 'actions']),
        limit: z.number().int().min(5).max(200).default(60),
      }),
      tier: 'SAFE',
      summarize: ({ from, to }) => `Look back at ${to && to !== from ? `${from} to ${to}` : from}`,
      async run({ from, to, include, limit }) {
        const range = d.dayRange(from, to ?? from);
        if (!range.from || !range.to) return fail('Give a valid date.');
        const want = new Set(include);
        const entries: TimelineEntry[] = [];
        if (want.has('notes'))
          for (const n of d.notesChanged(range.from, range.to, limit))
            entries.push({ at: n.updated_at, kind: 'note', text: `${n.vault_path} (${n.title})` });
        if (want.has('chats'))
          for (const m of d.messagesBetween(range.from, range.to, limit))
            entries.push({
              at: m.createdAt,
              kind: 'chat',
              text: `${m.role === 'user' ? 'sir' : 'assistant'}: ${m.snippet}`,
            });
        if (want.has('actions'))
          for (const a of d.actionsBetween(range.from, range.to, limit * 2))
            if (!SELF.has(a.tool_name))
              entries.push({ at: a.created_at, kind: 'action', text: actionLine(a) });
        const lines = mergeTimeline(entries, limit);
        return ok(lines.length ? lines.join('\n') : 'Nothing recorded on those days.');
      },
    }),
  ];
}
