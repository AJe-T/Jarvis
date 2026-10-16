import type { Citation, UiMessage, UiToolCall } from '@shared/types';
import type { MessageRow } from '../db/repos/conversations-repo';
import { stripMood } from './mood';

type Block = {
  type: string;
  id?: string;
  text?: string;
  citations?: Array<{ type: string; url?: string; title?: string | null }> | null;
};

/** Strips the voice-mode <spoken> wrapper and mood tags for display (the sentence stays, the tags go). */
export function displayText(text: string): string {
  return stripMood(text)
    .replace(/<\/?spoken>/g, '')
    .replace(/^\s+/, '');
}

/**
 * Turns stored API messages into chat bubbles: each of Sir's messages, then one Jarvis bubble per
 * turn combining all assistant text and the tool calls made in that turn.
 */
export function buildUiMessages(
  rows: MessageRow[],
  toolCallsByUseId: Map<string, UiToolCall>,
): UiMessage[] {
  const out: UiMessage[] = [];
  let current: UiMessage | null = null;

  for (const row of rows) {
    const blocks = JSON.parse(row.content_json) as Block[] | string;
    const list: Block[] = typeof blocks === 'string' ? [{ type: 'text', text: blocks }] : blocks;

    if (row.role === 'user' && row.source !== 'system') {
      current = null;
      out.push({
        id: row.id,
        role: 'user',
        text: list
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('\n'),
        source: row.source === 'voice' ? 'voice' : 'text',
        createdAt: row.created_at,
      });
      continue;
    }
    if (row.role === 'user') continue; // tool_result carrier

    if (!current) {
      current = {
        id: row.id,
        role: 'assistant',
        text: '',
        createdAt: row.created_at,
        toolCalls: [],
        citations: [],
      };
      out.push(current);
    }
    const text = list
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    if (text) current.text = current.text ? `${current.text}\n\n${text}` : text;
    for (const b of list) {
      if (b.type === 'tool_use' && b.id) {
        const call = toolCallsByUseId.get(b.id);
        if (call) current.toolCalls?.push(call);
      }
      for (const c of b.citations ?? []) {
        const cites = current.citations as Citation[];
        if (c.type === 'web_search_result_location' && c.url && !cites.some((x) => x.url === c.url))
          cites.push({ url: c.url, title: c.title ?? c.url });
      }
    }
    if (row.stop_reason === 'interrupted') current.interrupted = true;
  }
  return out.map((m) => (m.role === 'assistant' ? { ...m, text: displayText(m.text) } : m));
}
