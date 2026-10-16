import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { keywords, toFtsQuery } from '../db/fts-query';
import { defineTool, fail, type Tool, type ToolOutput } from './types';

/**
 * Saved tool outputs (idea from mksglu/context-mode; our own code, ELv2 not copied). A tool result
 * too big for one message is not thrown away past 20 KB: the executor keeps the full text in an
 * in-memory SQLite FTS5 index and shows Claude the start plus an id. `search_tool_output` then
 * finds (BM25, porter stemming) or reads the rest. Memory only: nothing reaches disk, and the
 * oldest outputs are dropped first.
 */

const PART_CHARS = 1_500;
const MAX_ENTRIES = 30;
const MAX_ONE = 2_000_000;
const MAX_TOTAL = 8_000_000;
const MAX_HITS = 4;

export interface SavedOutput {
  id: string;
  conversationId: string;
  toolName: string;
  untrusted: boolean;
  source: string;
  /** Length of the original output; only the first MAX_ONE chars are saved. */
  chars: number;
  cut: boolean;
  parts: number;
  /** Parts fully covered by the preview Claude already saw. */
  shownParts: number;
}

export interface OutputHit {
  part: number;
  text: string;
}

/** Splits on line breaks into parts of at most `size` chars; a single huge line is cut hard. */
export function splitParts(text: string, size = PART_CHARS): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    for (let i = 0; i === 0 || i < line.length; i += size) {
      const piece = line.slice(i, i + size);
      if (cur.length > 0 && cur.length + piece.length + 1 > size) {
        parts.push(cur);
        cur = piece;
      } else {
        cur = cur.length > 0 ? `${cur}\n${piece}` : piece;
      }
    }
  }
  if (cur.trim().length > 0) parts.push(cur);
  return parts;
}

export function createOutputStore() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE VIRTUAL TABLE parts USING fts5(output_id UNINDEXED, part UNINDEXED, text, tokenize = 'porter unicode61')",
  );
  const insert = db.prepare('INSERT INTO parts (output_id, part, text) VALUES (?, ?, ?)');
  const entries = new Map<string, SavedOutput>(); // insertion order = oldest first
  let total = 0;
  let seq = 0;

  function drop(id: string): void {
    const e = entries.get(id);
    if (!e) return;
    db.prepare('DELETE FROM parts WHERE output_id = ?').run(id);
    entries.delete(id);
    total -= Math.min(e.chars, MAX_ONE);
  }

  return {
    /** Indexes `text`; `shownChars` is how much of it Claude saw in the preview. */
    save(r: {
      conversationId: string;
      toolName: string;
      text: string;
      untrusted: boolean;
      source: string;
      shownChars: number;
    }): SavedOutput {
      const text = r.text.slice(0, MAX_ONE);
      const parts = splitParts(text);
      const id = `o${++seq}`;
      let seen = 0;
      let shownParts = 0;
      db.exec('BEGIN');
      try {
        parts.forEach((p, i) => {
          insert.run(id, i + 1, p);
          seen += p.length + 1;
          if (seen <= r.shownChars) shownParts = i + 1;
        });
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      const entry: SavedOutput = {
        id,
        conversationId: r.conversationId,
        toolName: r.toolName,
        untrusted: r.untrusted,
        source: r.source,
        chars: r.text.length,
        cut: r.text.length > MAX_ONE,
        parts: parts.length,
        shownParts,
      };
      entries.set(id, entry);
      total += text.length;
      while (entries.size > MAX_ENTRIES || total > MAX_TOTAL) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined || oldest === id) break;
        drop(oldest);
      }
      return entry;
    },
    get: (id: string): SavedOutput | undefined => entries.get(id),
    /** Best-matching parts, best first. User text never reaches MATCH raw (Database.md §5). */
    search(id: string, query: string, limit = MAX_HITS): OutputHit[] {
      const match = toFtsQuery(query);
      if (!match || !entries.has(id)) return [];
      return db
        .prepare(
          'SELECT part, text FROM parts WHERE parts MATCH ? AND output_id = ? ORDER BY rank LIMIT ?',
        )
        .all(match, id, limit) as unknown as OutputHit[];
    },
    part(id: string, n: number): string | undefined {
      const row = db
        .prepare('SELECT text FROM parts WHERE output_id = ? AND part = ?')
        .get(id, n) as { text: string } | undefined;
      return row?.text;
    },
  };
}

export type OutputStore = ReturnType<typeof createOutputStore>;

/** The note appended after the preview of a saved output. */
export function savedNote(e: SavedOutput): string {
  const next = e.shownParts < e.parts ? ` Unseen text starts around part ${e.shownParts + 1}.` : '';
  return `[Output too long: showing the start of ${e.chars.toLocaleString('en-US')} characters. ${e.cut ? `The first ${MAX_ONE.toLocaleString('en-US')} characters are` : 'The full text is'} saved as "${e.id}" (${e.parts} parts). Call search_tool_output with id "${e.id}" and a query to find something in it, or a part number to read on.${next} Do not re-run the tool.]`;
}

export function createSavedOutputTools(store: OutputStore): Tool[] {
  return [
    defineTool({
      name: 'search_tool_output',
      description:
        'Search or read a long tool result that was cut short (its note gives an id like "o3"). query: words to look for; returns the best-matching parts. part: read one part by number instead (to read on). Use this rather than running the original tool again.',
      input: z.object({
        id: z.string().regex(/^o\d{1,9}$/),
        query: z.string().trim().min(1).max(300).optional(),
        part: z.number().int().min(1).max(100_000).optional(),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      timeoutMs: 5_000,
      summarize: ({ id, query, part }) =>
        query
          ? `Search saved output ${id} for "${query.slice(0, 40)}"`
          : `Read part ${part ?? 1} of saved output ${id}`,
      async run({ id, query, part }, ctx): Promise<ToolOutput> {
        const e = store.get(id);
        // Outputs are scoped to the conversation that produced them.
        if (!e || e.conversationId !== ctx.conversationId)
          return fail(
            `No saved output "${id}" in this conversation (old ones are dropped). Run the tool again if needed.`,
          );
        const trust = { untrusted: e.untrusted, untrustedSource: e.source };
        const head = `Saved output ${id} (${e.toolName}, ${e.parts} parts)`;
        if (query === undefined) {
          const n = part ?? 1;
          const text = store.part(id, n);
          if (text === undefined) return fail(`${head} has no part ${n}.`);
          return { content: [{ type: 'text', text: `${head}, part ${n}:\n\n${text}` }], ...trust };
        }
        if (keywords(query).length === 0)
          return fail(
            `"${query}" has no searchable words (common words are ignored). Use more specific words, or read a part by number.`,
          );
        const hits = store.search(id, query);
        if (hits.length === 0)
          return {
            content: [
              {
                type: 'text',
                text: `${head}: nothing matches "${query}". Try other words, or read a part by number.`,
              },
            ],
            ...trust,
          };
        const body = hits.map((h) => `--- part ${h.part} ---\n${h.text}`).join('\n\n');
        return {
          content: [{ type: 'text', text: `${head}, best matches for "${query}":\n\n${body}` }],
          ...trust,
        };
      },
    }),
  ];
}
