import os from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';
import type { ConversationsRepo, MessageRow } from '../db/repos/conversations-repo';
import type { MessageParam } from '../llm/types';
import { STATIC_PERSONA_AND_RULES, buildDynamicBlock } from './prompts/orchestrator';

export const HISTORY_WINDOW = 30;

export interface ContextProviders {
  coreProfile(): Promise<string>;
  retrieve(userText: string): Promise<string>;
  integrations(): string;
  allowedRoots(): string[];
  screenCount(): number;
}

export const NO_PROVIDERS: ContextProviders = {
  coreProfile: async () => '',
  retrieve: async () => '',
  integrations: () => '',
  allowedRoots: () => [],
  screenCount: () => 1,
};

type Block = Exclude<MessageParam['content'], string>[number];

function blocksOf(m: MessageParam): Block[] {
  return typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [...m.content];
}

function isUserTextRow(r: MessageRow): boolean {
  return r.role === 'user' && r.source !== 'system';
}

/** Rows to send verbatim: after the summary, at most HISTORY_WINDOW, starting at one of Sir's messages. */
export function historyWindow(
  rows: MessageRow[],
  summaryUptoSeq: number,
): { included: MessageRow[]; cutSeq: number } {
  const recent = rows.filter((r) => r.seq > summaryUptoSeq);
  let start = Math.max(0, recent.length - HISTORY_WINDOW);
  while (start < recent.length && !isUserTextRow(recent[start] as MessageRow)) start++;
  const included = recent.slice(start);
  const cutSeq = included[0] ? included[0].seq - 1 : (rows.at(-1)?.seq ?? summaryUptoSeq);
  return { included, cutSeq };
}

/**
 * Makes stored history valid for the API: merges consecutive same-role messages and answers any
 * tool_use left without a tool_result (e.g., the app quit mid-turn). API-Guide.md §3.4.
 */
export function normalizeHistory(messages: MessageParam[]): MessageParam[] {
  const merged: MessageParam[] = [];
  for (const m of messages) {
    const prev = merged.at(-1);
    if (prev && prev.role === m.role) {
      const combined = [...blocksOf(prev), ...blocksOf(m)];
      // tool_result blocks must lead a user message.
      if (m.role === 'user')
        combined.sort(
          (a, b) => Number(b.type === 'tool_result') - Number(a.type === 'tool_result'),
        );
      merged[merged.length - 1] = { role: m.role, content: combined };
    } else {
      merged.push({ role: m.role, content: blocksOf(m) });
    }
  }
  while (merged[0] && merged[0].role !== 'user') merged.shift();

  const out: MessageParam[] = [];
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i] as MessageParam;
    out.push(m);
    if (m.role !== 'assistant') continue;
    const toolIds = blocksOf(m).flatMap((b) => (b.type === 'tool_use' ? [b.id] : []));
    if (toolIds.length === 0) continue;
    const next = merged[i + 1];
    const answered = new Set(
      next ? blocksOf(next).flatMap((b) => (b.type === 'tool_result' ? [b.tool_use_id] : [])) : [],
    );
    const missing: Anthropic.ToolResultBlockParam[] = toolIds
      .filter((id) => !answered.has(id))
      .map((id) => ({
        type: 'tool_result',
        tool_use_id: id,
        is_error: true,
        content: 'Not executed: the turn was interrupted.',
      }));
    if (missing.length === 0) continue;
    if (next && next.role === 'user') {
      merged[i + 1] = { role: 'user', content: [...missing, ...blocksOf(next)] };
    } else {
      out.push({ role: 'user', content: missing });
    }
  }
  return out;
}

/** Marks the end of the conversation prefix so multi-step tool loops re-read it from cache. */
function withCacheOnLastBlock(messages: MessageParam[]): MessageParam[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const blocks = blocksOf(last);
  const tail = blocks.at(-1);
  if (!tail || !['text', 'tool_result', 'image', 'document'].includes(tail.type)) return messages;
  const marked = { ...tail, cache_control: { type: 'ephemeral' } } as Block;
  return [...messages.slice(0, -1), { role: last.role, content: [...blocks.slice(0, -1), marked] }];
}

export function createContextBuilder(deps: {
  conversations: ConversationsRepo;
  providers: ContextProviders;
}) {
  return {
    history(conversationId: string): MessageParam[] {
      const conv = deps.conversations.get(conversationId);
      const rows = deps.conversations.messages(conversationId);
      const { included } = historyWindow(rows, conv?.summary_upto_seq ?? 0);
      return normalizeHistory(
        included.map((r) => ({
          role: r.role,
          content: JSON.parse(r.content_json) as MessageParam['content'],
        })),
      );
    },

    async system(opts: {
      conversationId: string;
      mode: 'text' | 'voice';
      userText: string;
      now?: Date;
    }): Promise<Anthropic.TextBlockParam[]> {
      const now = opts.now ?? new Date();
      const conv = deps.conversations.get(opts.conversationId);
      const [coreProfile, retrievedMemories] = await Promise.all([
        deps.providers.coreProfile(),
        deps.providers.retrieve(opts.userText),
      ]);
      const dynamic = buildDynamicBlock({
        localDateTime: now.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        mode: opts.mode,
        machine: `${os.version()} ${os.release()}, ${deps.providers.screenCount()} display(s)`,
        integrations: deps.providers.integrations(),
        allowedRoots: deps.providers.allowedRoots(),
        coreProfile,
        retrievedMemories,
        earlierSummary: conv?.summary ?? null,
      });
      return [
        { type: 'text', text: STATIC_PERSONA_AND_RULES, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamic },
      ];
    },

    withCacheOnLastBlock,
  };
}

export type ContextBuilder = ReturnType<typeof createContextBuilder>;
