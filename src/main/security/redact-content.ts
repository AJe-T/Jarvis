import { redact, redactDeep } from './redact';

type Json = Record<string, unknown>;

/**
 * Redacts Claude message content before it is stored. Binary payloads (base64 images/PDFs) and opaque
 * fields (encrypted search results, signatures) are left alone: regexes would corrupt them and they
 * are not human-readable text.
 */
export function redactContent(content: unknown): unknown {
  if (typeof content === 'string') return redact(content);
  if (!Array.isArray(content)) return content;
  return content.map((block: unknown) => redactBlock(block));
}

function redactBlock(block: unknown): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as Json;
  switch (b['type']) {
    case 'text':
      return { ...b, text: typeof b['text'] === 'string' ? redact(b['text']) : b['text'] };
    case 'tool_use':
    case 'server_tool_use':
      return { ...b, input: redactDeep(b['input']) };
    case 'tool_result':
      return { ...b, content: redactContent(b['content']) };
    default:
      // image, document, web_search_tool_result, thinking, etc.
      return b;
  }
}
