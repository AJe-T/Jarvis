import type { ConversationSummary } from '@shared/types';
import { newId, nowIso } from '../../lib/util';
import { tx, type Db, type SqlValue } from '../connection';

export type ConversationSource = 'text' | 'voice' | 'mixed';
export type MessageSource = 'text' | 'voice' | 'system';

export interface ConversationRow {
  id: string;
  title: string | null;
  started_at: string;
  last_active_at: string;
  summary: string | null;
  summary_upto_seq: number;
  source: ConversationSource;
  is_private: number;
  vault_log_path: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content_json: string;
  text_plain: string;
  source: MessageSource | null;
  model: string | null;
  stop_reason: string | null;
  created_at: string;
}

export interface NewMessage {
  role: 'user' | 'assistant';
  content: unknown;
  textPlain: string;
  source: MessageSource;
  model?: string;
  stopReason?: string | null;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export function toSummary(r: ConversationRow): ConversationSummary {
  return { id: r.id, title: r.title, lastActiveAt: r.last_active_at, source: r.source };
}

export function createConversationsRepo(db: Db) {
  const get = (id: string): ConversationRow | undefined =>
    db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;

  return {
    get,

    create(source: ConversationSource, isPrivate = false): ConversationRow {
      const id = newId('c_');
      const now = nowIso();
      db.prepare(
        'INSERT INTO conversations (id, started_at, last_active_at, source, is_private) VALUES (?, ?, ?, ?, ?)',
      ).run(id, now, now, source, isPrivate ? 1 : 0);
      const row = get(id);
      if (!row) throw new Error('conversation insert failed');
      return row;
    },

    list(limit: number, beforeLastActive?: string): ConversationRow[] {
      const params: SqlValue[] = [];
      let where = '';
      if (beforeLastActive) {
        where = 'WHERE last_active_at < ?';
        params.push(beforeLastActive);
      }
      params.push(limit);
      return db
        .prepare(`SELECT * FROM conversations ${where} ORDER BY last_active_at DESC LIMIT ?`)
        .all(...params) as unknown as ConversationRow[];
    },

    touch(id: string, source: 'text' | 'voice'): void {
      const row = get(id);
      if (!row) return;
      const merged: ConversationSource = row.source === source ? source : 'mixed';
      db.prepare('UPDATE conversations SET last_active_at = ?, source = ? WHERE id = ?').run(
        nowIso(),
        merged,
        id,
      );
    },

    setTitle(id: string, title: string): void {
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
    },

    setSummary(id: string, summary: string, uptoSeq: number): void {
      db.prepare('UPDATE conversations SET summary = ?, summary_upto_seq = ? WHERE id = ?').run(
        summary,
        uptoSeq,
        id,
      );
    },

    setVaultLogPath(id: string, path: string): void {
      db.prepare('UPDATE conversations SET vault_log_path = ? WHERE id = ?').run(path, id);
    },

    addUsage(id: string, input: number, output: number, cost: number): void {
      db.prepare(
        `UPDATE conversations SET total_input_tokens = total_input_tokens + ?,
         total_output_tokens = total_output_tokens + ?, est_cost_usd = est_cost_usd + ? WHERE id = ?`,
      ).run(input, output, cost, id);
    },

    delete(id: string): void {
      db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    },

    appendMessages(conversationId: string, messages: NewMessage[]): MessageRow[] {
      return tx(db, () => {
        const maxRow = db
          .prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE conversation_id = ?')
          .get(conversationId) as { s: number };
        let seq = maxRow.s;
        const insert = db.prepare(
          `INSERT INTO messages (id, conversation_id, seq, role, content_json, text_plain, source, model, stop_reason,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const ids: string[] = [];
        for (const m of messages) {
          const id = newId('m_');
          seq += 1;
          insert.run(
            id,
            conversationId,
            seq,
            m.role,
            JSON.stringify(m.content),
            m.textPlain,
            m.source,
            m.model ?? null,
            m.stopReason ?? null,
            m.usage?.input ?? null,
            m.usage?.output ?? null,
            m.usage?.cacheRead ?? null,
            m.usage?.cacheWrite ?? null,
            nowIso(),
          );
          ids.push(id);
        }
        const placeholders = ids.map(() => '?').join(',');
        return db
          .prepare(`SELECT * FROM messages WHERE id IN (${placeholders}) ORDER BY seq`)
          .all(...ids) as unknown as MessageRow[];
      });
    },

    messages(conversationId: string): MessageRow[] {
      return db
        .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq')
        .all(conversationId) as unknown as MessageRow[];
    },

    messageCount(conversationId: string): number {
      return (
        db
          .prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?')
          .get(conversationId) as { n: number }
      ).n;
    },

    /** Full-text search; `range` (ISO instants, end exclusive) limits it to a period. */
    searchMessages(ftsQuery: string, limit: number, range: { from?: string; to?: string } = {}) {
      return db
        .prepare(
          `SELECT m.id AS id, m.conversation_id AS conversationId, m.created_at AS createdAt, m.role AS role, c.title AS title,
             snippet(messages_fts, 0, '[', ']', '…', 16) AS snippet
           FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
           JOIN conversations c ON c.id = m.conversation_id
           WHERE messages_fts MATCH ? AND c.is_private = 0 AND m.created_at >= ? AND m.created_at < ?
           ORDER BY bm25(messages_fts) LIMIT ?`,
        )
        .all(ftsQuery, range.from ?? '', range.to ?? '9999', limit) as unknown as MessageHit[];
    },

    /** What was said in a period, oldest first (date-scoped recall, idea from isair/jarvis's diary). */
    messagesBetween(fromIso: string, toIso: string, limit: number): MessageHit[] {
      return db
        .prepare(
          `SELECT m.id AS id, m.conversation_id AS conversationId, m.created_at AS createdAt, m.role AS role, c.title AS title,
             substr(m.text_plain, 1, 240) AS snippet
           FROM messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE c.is_private = 0 AND m.role IN ('user', 'assistant') AND m.text_plain != ''
             AND m.created_at >= ? AND m.created_at < ?
           ORDER BY m.created_at LIMIT ?`,
        )
        .all(fromIso, toIso, limit) as unknown as MessageHit[];
    },

    /** Messages by id (semantic hits), private conversations and out-of-range ones left out. */
    messagesByIds(ids: string[], range: { from?: string; to?: string } = {}): MessageHit[] {
      if (ids.length === 0) return [];
      return db
        .prepare(
          `SELECT m.id AS id, m.conversation_id AS conversationId, m.created_at AS createdAt, m.role AS role, c.title AS title,
             substr(m.text_plain, 1, 240) AS snippet
           FROM messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE c.is_private = 0 AND m.created_at >= ? AND m.created_at < ?
             AND m.id IN (SELECT value FROM json_each(?))`,
        )
        .all(range.from ?? '', range.to ?? '9999', JSON.stringify(ids)) as unknown as MessageHit[];
    },

    /**
     * Chat rewind (idea from isair/jarvis): drops Sir's Nth typed/spoken message (0-based) and
     * everything after it, so the conversation continues from just before it. Returns its text.
     */
    rewind(conversationId: string, userIndex: number): string | null {
      const row = (
        db
          .prepare(
            `SELECT seq, text_plain FROM messages WHERE conversation_id = ? AND role = 'user'
               AND (source IS NULL OR source != 'system') ORDER BY seq`,
          )
          .all(conversationId) as Array<{ seq: number; text_plain: string }>
      )[userIndex];
      if (!row) return null;
      tx(db, () => {
        db.prepare('DELETE FROM messages WHERE conversation_id = ? AND seq >= ?').run(
          conversationId,
          row.seq,
        );
        // The rolling summary may describe what was just removed.
        db.prepare(
          'UPDATE conversations SET summary = NULL, summary_upto_seq = 0 WHERE id = ? AND summary_upto_seq >= ?',
        ).run(conversationId, row.seq);
      });
      return row.text_plain;
    },

    deleteMessagesOlderThan(isoCutoff: string): number {
      return Number(db.prepare('DELETE FROM messages WHERE created_at < ?').run(isoCutoff).changes);
    },
  };
}

export type ConversationsRepo = ReturnType<typeof createConversationsRepo>;

export interface MessageHit {
  id: string;
  conversationId: string;
  createdAt: string;
  role: string;
  title: string | null;
  snippet: string;
}
