import { newId, nowIso } from '../../lib/util';
import { tx, type Db } from '../connection';

export type MemoryKind =
  'profile' | 'preference' | 'person' | 'project' | 'fact' | 'routine' | 'note';
export type MemorySource = 'curator' | 'memory_tool' | 'user_edit' | 'import';

export interface MemoryRow {
  id: string;
  vault_path: string;
  title: string;
  kind: MemoryKind;
  tags_json: string;
  body: string;
  content_hash: string;
  source: MemorySource;
  updated_at: string;
}

export interface VaultFileRow {
  vault_path: string;
  content_hash: string;
  mtime_ms: number;
  last_writer: 'jarvis' | 'external';
}

export interface ReviewRow {
  id: string;
  op: 'ADD' | 'UPDATE' | 'DELETE';
  target_path: string | null;
  proposed_markdown: string | null;
  reason: string;
  conversation_id: string | null;
  created_at: string;
  resolved: 'accepted' | 'rejected' | null;
}

export interface RoutineRow {
  id: string;
  name: string;
  vault_path: string;
  trigger_phrases_json: string;
  steps_json: string;
  enabled: number;
  error: string | null;
  last_run_at: string | null;
}

export function createMemoryRepos(db: Db) {
  return {
    memories: {
      upsert(m: {
        vaultPath: string;
        title: string;
        kind: MemoryKind;
        tags: string[];
        body: string;
        hash: string;
        source: MemorySource;
        mtimeMs: number;
      }): void {
        const now = nowIso();
        db.prepare(
          `INSERT INTO memories (id, vault_path, title, kind, tags_json, body, content_hash, source, created_at, updated_at, file_mtime_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(vault_path) DO UPDATE SET title = excluded.title, kind = excluded.kind, tags_json = excluded.tags_json,
             body = excluded.body, content_hash = excluded.content_hash, source = excluded.source, updated_at = excluded.updated_at,
             file_mtime_ms = excluded.file_mtime_ms`,
        ).run(
          newId('mem_'),
          m.vaultPath,
          m.title,
          m.kind,
          JSON.stringify(m.tags),
          m.body,
          m.hash,
          m.source,
          now,
          now,
          m.mtimeMs,
        );
      },
      remove(vaultPath: string): void {
        db.prepare('DELETE FROM memories WHERE vault_path = ?').run(vaultPath);
      },
      get(vaultPath: string): MemoryRow | undefined {
        return db.prepare('SELECT * FROM memories WHERE vault_path = ?').get(vaultPath) as
          MemoryRow | undefined;
      },
      search(ftsQuery: string, k: number): Array<MemoryRow & { snippet: string }> {
        return db
          .prepare(
            `SELECT m.*, snippet(memories_fts, 1, '[', ']', '…', 16) AS snippet
             FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid
             WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts, 3.0, 1.0, 2.0) LIMIT ?`,
          )
          .all(ftsQuery, k) as unknown as Array<MemoryRow & { snippet: string }>;
      },
      titles(): string[] {
        return (db.prepare('SELECT title FROM memories').all() as Array<{ title: string }>).map(
          (r) => r.title,
        );
      },
      count(): number {
        return (db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }).n;
      },
    },

    vaultFiles: {
      get(vaultPath: string): VaultFileRow | undefined {
        return db.prepare('SELECT * FROM vault_files WHERE vault_path = ?').get(vaultPath) as
          VaultFileRow | undefined;
      },
      upsert(
        vaultPath: string,
        hash: string,
        mtimeMs: number,
        writer: 'jarvis' | 'external',
      ): void {
        db.prepare(
          `INSERT INTO vault_files (vault_path, content_hash, mtime_ms, indexed_at, last_writer) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(vault_path) DO UPDATE SET content_hash = excluded.content_hash, mtime_ms = excluded.mtime_ms,
             indexed_at = excluded.indexed_at, last_writer = excluded.last_writer`,
        ).run(vaultPath, hash, mtimeMs, nowIso(), writer);
      },
      remove(vaultPath: string): void {
        db.prepare('DELETE FROM vault_files WHERE vault_path = ?').run(vaultPath);
      },
    },

    review: {
      add(r: {
        op: ReviewRow['op'];
        targetPath: string | null;
        proposedMarkdown: string | null;
        reason: string;
        conversationId: string | null;
      }): void {
        db.prepare(
          'INSERT INTO memory_review_queue (id, op, target_path, proposed_markdown, reason, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          newId('rq_'),
          r.op,
          r.targetPath,
          r.proposedMarkdown,
          r.reason,
          r.conversationId,
          nowIso(),
        );
      },
      pending(): ReviewRow[] {
        return db
          .prepare('SELECT * FROM memory_review_queue WHERE resolved IS NULL ORDER BY created_at')
          .all() as unknown as ReviewRow[];
      },
      get(id: string): ReviewRow | undefined {
        return db.prepare('SELECT * FROM memory_review_queue WHERE id = ?').get(id) as
          ReviewRow | undefined;
      },
      resolve(id: string, resolved: 'accepted' | 'rejected'): void {
        db.prepare('UPDATE memory_review_queue SET resolved = ? WHERE id = ?').run(resolved, id);
      },
    },

    routines: {
      replaceAll(rows: Array<Omit<RoutineRow, 'id' | 'last_run_at'>>): void {
        tx(db, () => {
          const lastRuns = new Map(
            (
              db.prepare('SELECT name, last_run_at FROM routines').all() as Array<{
                name: string;
                last_run_at: string | null;
              }>
            ).map((r) => [r.name, r.last_run_at]),
          );
          db.exec('DELETE FROM routines');
          const insert = db.prepare(
            'INSERT INTO routines (id, name, vault_path, trigger_phrases_json, steps_json, enabled, error, last_run_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          );
          for (const r of rows)
            insert.run(
              newId('rt_'),
              r.name,
              r.vault_path,
              r.trigger_phrases_json,
              r.steps_json,
              r.enabled,
              r.error,
              lastRuns.get(r.name) ?? null,
              nowIso(),
            );
        });
      },
      all(): RoutineRow[] {
        return db.prepare('SELECT * FROM routines ORDER BY name').all() as unknown as RoutineRow[];
      },
      byName(name: string): RoutineRow | undefined {
        return db.prepare('SELECT * FROM routines WHERE lower(name) = lower(?)').get(name) as
          RoutineRow | undefined;
      },
      markRun(id: string): void {
        db.prepare('UPDATE routines SET last_run_at = ? WHERE id = ?').run(nowIso(), id);
      },
    },

    /** Database.md §7 "Rebuild index". */
    truncateIndex(): void {
      tx(db, () => {
        db.exec('DELETE FROM memories');
        db.exec('DELETE FROM vault_files');
        db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
      });
    },
  };
}

export type MemoryRepos = ReturnType<typeof createMemoryRepos>;
