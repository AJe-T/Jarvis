import type { MessageRow } from '../db/repos/conversations-repo';
import { historyWindow } from './context-builder';

/**
 * Context meter (idea from LibreChat's context-usage inspector): how full the model's context is
 * for this conversation, split into dialogue, tool traffic and Jarvis's own instructions + tool list.
 */

/** Every model Jarvis uses accepts at least this many input tokens. */
export const CONTEXT_WINDOW = 200_000;
/** Rough size of English text in tokens (only used where nothing was measured). */
const CHARS_PER_TOKEN = 4;
/** What one image or PDF page roughly costs. */
const ATTACHMENT_TOKENS = 1600;

export interface ContextStats {
  usedTokens: number;
  windowTokens: number;
  dialogueTokens: number;
  toolTokens: number;
  /** Instructions, memory, skills and the tool list Jarvis sends every turn. */
  otherTokens: number;
  /** True when nothing was measured since the last compaction, so the numbers are estimates. */
  estimated: boolean;
  /** Messages sent verbatim next turn. */
  messages: number;
  /** Older messages folded into the running summary. */
  summarizedMessages: number;
}

type Block = { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };

const tok = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

function resultChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return (content as Block[]).reduce(
    (n, b) => n + (b.type === 'text' ? (b.text?.length ?? 0) : ATTACHMENT_TOKENS * CHARS_PER_TOKEN),
    0,
  );
}

/** Dialogue vs tool traffic in the rows that will be sent, in estimated tokens. */
export function splitHistory(rows: MessageRow[]): { dialogue: number; tools: number } {
  let dialogue = 0;
  let tools = 0;
  for (const r of rows) {
    let blocks: Block[] | string;
    try {
      blocks = JSON.parse(r.content_json) as Block[] | string;
    } catch {
      continue;
    }
    if (typeof blocks === 'string') {
      dialogue += blocks.length;
      continue;
    }
    for (const b of blocks) {
      if (b.type === 'text') dialogue += b.text?.length ?? 0;
      else if (b.type === 'image' || b.type === 'document')
        dialogue += ATTACHMENT_TOKENS * CHARS_PER_TOKEN;
      else if (b.type === 'tool_use')
        tools += (b.name?.length ?? 0) + JSON.stringify(b.input ?? {}).length;
      else if (b.type === 'tool_result') tools += resultChars(b.content);
      else tools += JSON.stringify(b).length;
    }
  }
  return { dialogue: tok(dialogue), tools: tok(tools) };
}

/**
 * The last request's measured input (input + cache read + cache write) when there is one after the
 * summary point; otherwise an estimate from the history plus `baseTokens` (instructions + tools).
 */
export function contextStats(
  rows: MessageRow[],
  summaryUptoSeq: number,
  baseTokens: number,
  windowTokens = CONTEXT_WINDOW,
): ContextStats {
  const { included } = historyWindow(rows, summaryUptoSeq);
  const { dialogue, tools } = splitHistory(included);
  const lastMeasured = [...rows]
    .reverse()
    .find(
      (r) => r.role === 'assistant' && r.seq > summaryUptoSeq && (r.input_tokens ?? null) !== null,
    );
  const summarizedMessages = rows.filter((r) => r.seq <= summaryUptoSeq).length;
  if (!lastMeasured) {
    return {
      usedTokens: baseTokens + dialogue + tools,
      windowTokens,
      dialogueTokens: dialogue,
      toolTokens: tools,
      otherTokens: baseTokens,
      estimated: true,
      messages: included.length,
      summarizedMessages,
    };
  }
  const used =
    (lastMeasured.input_tokens ?? 0) +
    (lastMeasured.cache_read_tokens ?? 0) +
    (lastMeasured.cache_write_tokens ?? 0);
  // Estimates can overshoot what was measured: scale them down to fit.
  const scale = dialogue + tools > used && used > 0 ? used / (dialogue + tools) : 1;
  const d = Math.round(dialogue * scale);
  const t = Math.round(tools * scale);
  return {
    usedTokens: used,
    windowTokens,
    dialogueTokens: d,
    toolTokens: t,
    otherTokens: Math.max(0, used - d - t),
    estimated: false,
    messages: included.length,
    summarizedMessages,
  };
}
