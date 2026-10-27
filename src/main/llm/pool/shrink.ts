import type { LlmRequest } from '../types';

/**
 * AI Router Phase 4 (`pool.shrink`): free models have small limits (Groq: 8K tokens a minute on
 * some models), so before a tier-2 request leaves, older tool output becomes a one-line stub,
 * text repeated word for word is sent once, and long older text is cut. The last few messages
 * (the current question and the latest tool results) are never touched.
 */

/** Messages at the end that stay exactly as they are. */
const KEEP_RECENT = 4;
const OLD_TEXT_MAX = 4000;
/** Short repeats ("OK", "Done") cost nothing; only longer duplicates are dropped. */
const REPEAT_MIN = 200;
export const TOOL_STUB = '[older tool output removed to fit the free model’s limits]';

type Message = LlmRequest['messages'][number];
type Block = Exclude<Message['content'], string>[number];

const cut = (t: string): string =>
  t.length > OLD_TEXT_MAX ? `${t.slice(0, OLD_TEXT_MAX)}… [cut to fit free limits]` : t;

export function shrinkRequest(req: LlmRequest): LlmRequest {
  const n = req.messages.length;
  const recent = new Set<string>();
  for (const m of req.messages.slice(Math.max(0, n - KEEP_RECENT)))
    for (const t of textsOf(m)) if (t.length >= REPEAT_MIN) recent.add(t);
  const seen = new Set<string>(recent);
  const older = (t: string): string | null => {
    if (t.length >= REPEAT_MIN && seen.has(t)) return null;
    if (t.length >= REPEAT_MIN) seen.add(t);
    return cut(t);
  };
  const messages = req.messages.map((m, i): Message => {
    if (i >= n - KEEP_RECENT) return m;
    if (typeof m.content === 'string') {
      const t = older(m.content);
      return { ...m, content: t ?? '[repeated text removed]' };
    }
    const content = m.content.flatMap((b): Block[] => {
      if (b.type === 'tool_result') return [{ ...b, content: TOOL_STUB }];
      if (b.type === 'text') {
        const t = older(b.text);
        return t === null ? [] : [{ ...b, text: t }];
      }
      return [b];
    });
    // A message left empty would be refused: keep a marker instead.
    return { ...m, content: content.length ? content : '[repeated text removed]' };
  });
  return { ...req, messages };
}

function textsOf(m: Message): string[] {
  return typeof m.content === 'string'
    ? [m.content]
    : m.content.flatMap((b) => (b.type === 'text' ? [b.text] : []));
}

/** A picture counts about this many tokens, whatever its base64 length. */
const IMAGE_TOKENS = 1600;

/** Rough tokens a request needs: its text (4 characters a token), pictures, room for the answer. */
export function estimateTokens(req: LlmRequest): number {
  let images = 0;
  const text = JSON.stringify([req.system ?? '', req.messages], (k, v: unknown) => {
    if (k === 'type' && v === 'image') images++;
    return k === 'data' && typeof v === 'string' ? '' : v;
  });
  return Math.ceil(text.length / 4) + images * IMAGE_TOKENS + req.max_tokens;
}
