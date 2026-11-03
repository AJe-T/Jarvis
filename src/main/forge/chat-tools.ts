import { z } from 'zod';
import { defineTool, fail, ok, type Tool, type ToolContext } from '../tools/types';
import type { ChatSource, ForgeChat } from './chat';
import { FORGE_ROOT, type ForgeStore } from './memory';

/**
 * F9–F10 tools around the Forge chat and Forge's memory.
 *
 * - `forge_chat` (Jarvis → Forge): hands Sir's request to the Forge desk and opens the Forge page. It
 *   takes **no text from the model**: it relays Sir's own last message of the turn, read from the
 *   conversation. Jarvis's prompt holds his memories, so text Jarvis wrote could carry them into Forge;
 *   Sir's own words can't (rule 2026-11-03: Forge never reads Jarvis's memory).
 * - `forge_memory` (Jarvis and the desk, read-only): Forge's notes, run notes, chats and notebooks.
 *   Jarvis may read Forge's memory; nothing here reaches outside `Forge/` (memory.ts checks every path).
 */

export interface ChatToolDeps {
  chat: ForgeChat;
  store: ForgeStore;
  /** Sir's latest message in this conversation, and whether he spoke it. */
  lastUserMessage(conversationId: string): { text: string; source: ChatSource } | null;
  /** The conversation is the Forge desk's own (its turns must not hand work to itself). */
  isDesk(conversationId: string): boolean;
  openForge(): void;
}

const MAX_LIST = 200;

export function createForgeChatTools(deps: ChatToolDeps): Tool[] {
  return [
    defineTool({
      name: 'forge_chat',
      description:
        'Hand sir\'s request about building or changing yourself ("learn to …", "teach yourself …", "use Forge to …", a Forge build or its progress) to the Forge desk: it opens Sidebar → Forge, where the desk agrees the goal with sir and runs the build. Takes no input: it passes sir\'s own words, exactly as he said them. Use it instead of starting Forge yourself whenever sir asks for a new ability or a change to you.',
      input: z.object({}),
      tier: 'SAFE',
      timeoutMs: 10_000,
      summarize: () => 'Hand this to the Forge desk',
      async run(_input, ctx: ToolContext) {
        if (deps.isDesk(ctx.conversationId))
          return fail('This is already the Forge desk; answer here.');
        const said = deps.lastUserMessage(ctx.conversationId);
        if (!said?.text.trim()) return fail('There is no message from sir to hand to Forge.');
        try {
          await deps.chat.send(said.text, said.source);
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        deps.openForge();
        return ok(
          "Handed to the Forge desk with sir's own words; it is answering in Sidebar → Forge (opened). Tell sir in one short sentence; don't start Forge yourself.",
        );
      },
    }),
    defineTool({
      name: 'forge_memory',
      description: `Read Forge's own memory (read-only): its notes (lessons, sir's build preferences), a note per finished run, its chats with sir and its notebooks, all under ${FORGE_ROOT}/ in the vault. action=search (query: words that must all appear on a line), list (path: a folder, default ${FORGE_ROOT}), read (path: a .md file from list or search). Use for "what did Forge build last week?", "why did that run fail?". It never shows sir's own memory.`,
      input: z.object({
        action: z.enum(['search', 'list', 'read']),
        query: z.string().trim().max(200).optional(),
        path: z.string().trim().max(300).optional(),
      }),
      tier: 'SAFE',
      // Run notes and chats hold Claude's summaries of repo code and check output.
      untrustedOutput: true,
      timeoutMs: 10_000,
      summarize: (i) =>
        i.action === 'search'
          ? `Search Forge's memory for "${i.query ?? ''}"`
          : `${i.action} ${i.path ?? FORGE_ROOT}`,
      async run(i) {
        try {
          if (i.action === 'search') {
            if (!i.query) return fail('Give the words to search for.');
            const hits = await deps.store.search(i.query);
            return ok(
              hits.length
                ? hits.map((h) => `${h.path}: ${h.line}`).join('\n')
                : `Nothing in Forge's memory matches "${i.query}".`,
            );
          }
          if (i.action === 'list') {
            const files = await deps.store.list(i.path || FORGE_ROOT);
            return ok(
              files.length
                ? files
                    .slice(0, MAX_LIST)
                    .map((f) => `${f.path}${f.isDir ? '/' : ` (${f.size} bytes)`}`)
                    .join('\n')
                : 'Empty.',
            );
          }
          if (!i.path) return fail('Give the path of the note to read (from list or search).');
          return ok(await deps.store.read(i.path));
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    }),
  ];
}
