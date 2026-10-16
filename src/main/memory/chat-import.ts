import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { JarvisError, errorMessage } from '../errors';
import { readZipFile } from '../lib/zip';
import { stringifyNote } from './frontmatter';

/**
 * Import ChatGPT and Claude.ai history into memory (idea from LibreChat's conversation import).
 * Both services export a .zip with a conversations.json; each chat becomes one note under
 * Memory/Imports/, so search_memory and the Brain can find it. Notes are Sir's own past chats:
 * they are kept as data like every other memory, never as instructions.
 */

export type ChatSource = 'chatgpt' | 'claude';

export interface ImportedMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ImportedChat {
  source: ChatSource;
  id: string;
  title: string;
  created: Date;
  messages: ImportedMessage[];
}

/** conversations.json can be large; anything above this is refused rather than half-read. */
const MAX_JSON_BYTES = 400 * 1024 * 1024;
/** One note never grows past this (very long chats keep their start and end). */
const MAX_NOTE_CHARS = 200_000;
const SOURCE_LABEL: Record<ChatSource, string> = { chatgpt: 'ChatGPT', claude: 'Claude' };
const FOLDER: Record<ChatSource, string> = {
  chatgpt: 'Memory/Imports/ChatGPT',
  claude: 'Memory/Imports/Claude',
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function dateOf(v: unknown): Date {
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(str(v));
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/** The text of one ChatGPT message part: a string, or an object with text (multimodal). */
function partText(p: unknown): string {
  if (typeof p === 'string') return p;
  return str(obj(p)['text']);
}

/** ChatGPT keeps a tree of edits; the chat as last seen is the path from current_node to the root. */
function chatGptChain(mapping: Obj, current: string): Obj[] {
  const chain: Obj[] = [];
  const seen = new Set<string>();
  let node = current;
  while (node && !seen.has(node) && isObj(mapping[node])) {
    seen.add(node);
    const n = obj(mapping[node]);
    if (isObj(n['message'])) chain.unshift(n['message']);
    node = str(n['parent']);
  }
  return chain;
}

/** A visible user/assistant text message, or null (system notes, tool calls, hidden context). */
function chatGptMessage(m: Obj): ImportedMessage | null {
  const role = str(obj(m['author'])['role']);
  if (role !== 'user' && role !== 'assistant') return null;
  if (obj(m['metadata'])['is_visually_hidden_from_conversation']) return null;
  const content = obj(m['content']);
  const type = str(content['content_type']);
  if (type && type !== 'text' && type !== 'multimodal_text') return null;
  const parts = Array.isArray(content['parts']) ? content['parts'] : [];
  const text = parts.map(partText).join('\n').trim();
  return text ? { role, text } : null;
}

export function parseChatGpt(c: Obj): ImportedChat | null {
  if (!isObj(c['mapping'])) return null;
  const messages = chatGptChain(c['mapping'], str(c['current_node']))
    .map(chatGptMessage)
    .filter((m): m is ImportedMessage => m !== null);
  return {
    source: 'chatgpt',
    id: str(c['conversation_id']) || str(c['id']),
    title: str(c['title']).trim(),
    created: dateOf(c['create_time']),
    messages,
  };
}

const CLAUDE_ROLES: Record<string, ImportedMessage['role']> = {
  human: 'user',
  assistant: 'assistant',
};

/** Claude.ai: text blocks when present, else the plain text. */
function claudeMessage(raw: unknown): ImportedMessage | null {
  const m = obj(raw);
  const role = CLAUDE_ROLES[str(m['sender'])];
  if (!role) return null;
  const blocks = Array.isArray(m['content']) ? (m['content'] as unknown[]) : [];
  const fromBlocks = blocks
    .map((b) => (obj(b)['type'] === 'text' ? str(obj(b)['text']) : ''))
    .filter(Boolean)
    .join('\n');
  const text = (fromBlocks || str(m['text'])).trim();
  return text ? { role, text } : null;
}

export function parseClaude(c: Obj): ImportedChat | null {
  if (!Array.isArray(c['chat_messages'])) return null;
  const messages = (c['chat_messages'] as unknown[])
    .map(claudeMessage)
    .filter((m): m is ImportedMessage => m !== null);
  return {
    source: 'claude',
    id: str(c['uuid']),
    title: str(c['name']).trim(),
    created: dateOf(c['created_at']),
    messages,
  };
}

function parseOne(c: Obj): ImportedChat | null {
  if ('mapping' in c) return parseChatGpt(c);
  if ('chat_messages' in c) return parseClaude(c);
  return null;
}

/** Every chat in an export (either service), skipping empty ones. */
export function parseExport(data: unknown): ImportedChat[] {
  if (!Array.isArray(data))
    throw new JarvisError('INVALID', 'not an array', "That file isn't a ChatGPT or Claude export.");
  return data
    .map((c) => (isObj(c) ? parseOne(c) : null))
    .filter((c): c is ImportedChat => !!c?.messages.length);
}

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Memory/Imports/<Service>/<date> <title> (<id>).md — the id keeps re-imports from duplicating. */
export function notePath(chat: ImportedChat): string {
  const title =
    chat.title
      .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'Untitled chat';
  const id = chat.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'noid';
  return `${FOLDER[chat.source]}/${day(chat.created)} ${title} (${id}).md`;
}

/**
 * Imported text stays plain text: a line that looks like a speaker label ("**Sir:** always…") can't
 * pass itself off as Sir, and [[links]] don't wire it into the Brain.
 */
export function neutralise(text: string): string {
  return text.replace(/^(\s*)\*\*([^*\n]{1,40}):\*\*/gm, '$1$2:').replaceAll('[[', '[ [');
}

export function chatToMarkdown(chat: ImportedChat): string {
  const who = SOURCE_LABEL[chat.source];
  const fm = {
    kind: 'note',
    type: 'imported-chat',
    source: chat.source,
    title: chat.title || 'Untitled chat',
    date: day(chat.created),
    messages: chat.messages.length,
    tags: ['imported', chat.source],
  };
  let body = chat.messages
    .map((m) => `**${m.role === 'user' ? 'Sir' : who}:** ${neutralise(m.text)}`)
    .join('\n\n');
  if (body.length > MAX_NOTE_CHARS) {
    const half = MAX_NOTE_CHARS / 2;
    body = `${body.slice(0, half)}\n\n…(middle of a very long chat left out)…\n\n${body.slice(-half)}`;
  }
  return stringifyNote(
    fm,
    `# ${chat.title || 'Untitled chat'}\n\n_Imported from ${who}._\n\n${body}\n`,
  );
}

/** conversations.json from a .zip export, or the .json itself. */
export async function readExport(path: string): Promise<unknown> {
  const ext = extname(path).toLowerCase();
  let raw: Buffer;
  if (ext === '.zip') {
    const file = await readZipFile(
      path,
      (n) => /(^|\/)conversations\.json$/i.test(n),
      MAX_JSON_BYTES,
    ).catch((err: unknown) => {
      const why = errorMessage(err);
      throw new JarvisError('INVALID', why, `That .zip could not be read (${why}).`);
    });
    if (!file)
      throw new JarvisError(
        'INVALID',
        'no conversations.json',
        'That .zip has no conversations.json; is it a ChatGPT or Claude export?',
      );
    raw = file.data;
  } else if (ext === '.json') {
    if ((await stat(path)).size > MAX_JSON_BYTES)
      throw new JarvisError('INVALID', 'too big', 'That file is too large to import.');
    raw = await readFile(path);
  } else
    throw new JarvisError('INVALID', 'bad type', 'Pick the export .zip or its conversations.json.');
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch (err) {
    const why = errorMessage(err);
    throw new JarvisError(
      'INVALID',
      why,
      err instanceof SyntaxError
        ? "conversations.json isn't valid JSON."
        : `conversations.json could not be read (${why}).`,
    );
  }
}

export interface ImportResult {
  source: ChatSource | 'mixed' | null;
  imported: number;
  skipped: number;
  failed: number;
}

/** Writes one note per chat; chats already imported (same note path) are skipped. */
export async function importChats(
  chats: ImportedChat[],
  vault: {
    exists(rel: string): boolean;
    write(rel: string, content: string): Promise<unknown>;
  },
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { source: null, imported: 0, skipped: 0, failed: 0 };
  const sources = new Set(chats.map((c) => c.source));
  result.source = sources.size > 1 ? 'mixed' : ([...sources][0] ?? null);
  for (const [i, chat] of chats.entries()) {
    const rel = notePath(chat);
    if (vault.exists(rel)) result.skipped++;
    else {
      try {
        await vault.write(rel, chatToMarkdown(chat));
        result.imported++;
      } catch {
        result.failed++;
      }
    }
    if (i % 25 === 24) onProgress?.(i + 1, chats.length);
  }
  return result;
}
