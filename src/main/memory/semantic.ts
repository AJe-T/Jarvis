import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/connection';
import { errorMessage } from '../errors';
import type { Logger } from '../logging/logger';

/**
 * Semantic memory search (idea from isair/jarvis; code is ours): memory notes and conversation
 * messages get an on-device MiniLM embedding, so "the thing about my sister's wedding" finds the note
 * titled "Priya" even with no shared keyword. Vectors live in SQLite; nothing leaves the PC.
 */

export const EMBED_DIM = 384;
const BATCH = 16;
const MAX_CHARS = 1000;
const MIN_MESSAGE_CHARS = 12;
/** Below this cosine similarity a hit is noise. */
const MIN_SCORE = 0.2; // MiniLM: related phrasing ~0.25–0.6, unrelated < 0.15

export type EmbedKind = 'memory' | 'message';

export interface Embedder {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** `dir` is models/minilm-embed (pinned transformers.js layout, verified on download). */
export async function loadEmbedder(dir: string): Promise<Embedder> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '';
  const extract = await pipeline('feature-extraction', dir, { dtype: 'q8', device: 'cpu' });
  return {
    async embed(texts) {
      const out = await extract(texts, { pooling: 'mean', normalize: true });
      const data = out.data as Float32Array;
      return texts.map((_, i) => data.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM));
    },
  };
}

const toBlob = (v: Float32Array): Uint8Array =>
  new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
// Copy: a BLOB's byte offset need not be 4-aligned.
const fromBlob = (b: Uint8Array): Float32Array => new Float32Array(Uint8Array.from(b).buffer);

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export function createSemanticIndex(deps: {
  db: Db;
  modelDir: string;
  enabled(): boolean;
  logger: Logger;
  /** Tests inject a fake. */
  load?(dir: string): Promise<Embedder>;
}) {
  const log = deps.logger.child({ module: 'semantic' });
  let embedder: Promise<Embedder> | null = null;
  let syncing: Promise<void> | null = null;

  const installed = (): boolean =>
    existsSync(join(deps.modelDir, 'onnx', 'model_quantized.onnx')) || !!deps.load;
  const ready = (): boolean => deps.enabled() && installed();

  function model(): Promise<Embedder> {
    if (!embedder) {
      const p = (deps.load ?? loadEmbedder)(deps.modelDir);
      p.catch(() => {
        if (embedder === p) embedder = null;
      });
      embedder = p;
    }
    return embedder;
  }

  /** Rows whose vector is missing or stale. */
  function pending(
    limit: number,
  ): Array<{ kind: EmbedKind; ref: string; hash: string; text: string }> {
    const memories = deps.db
      .prepare(
        `SELECT m.vault_path AS ref, m.content_hash AS hash, m.title || '\n' || m.body AS text
         FROM memories m LEFT JOIN embeddings e ON e.kind = 'memory' AND e.ref = m.vault_path
         WHERE e.hash IS NULL OR e.hash != m.content_hash LIMIT ?`,
      )
      .all(limit) as Array<{ ref: string; hash: string; text: string }>;
    const messages = deps.db
      .prepare(
        `SELECT m.id AS ref, 'm' AS hash, m.text_plain AS text
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN embeddings e ON e.kind = 'message' AND e.ref = m.id
         WHERE e.ref IS NULL AND c.is_private = 0 AND length(m.text_plain) >= ? LIMIT ?`,
      )
      .all(MIN_MESSAGE_CHARS, Math.max(0, limit - memories.length)) as Array<{
      ref: string;
      hash: string;
      text: string;
    }>;
    return [
      ...memories.map((r) => ({ ...r, kind: 'memory' as const })),
      ...messages.map((r) => ({ ...r, kind: 'message' as const })),
    ];
  }

  async function syncAll(): Promise<void> {
    // Deleted notes and messages (forget, retention) lose their vectors too.
    deps.db.exec(
      `DELETE FROM embeddings WHERE (kind = 'memory' AND ref NOT IN (SELECT vault_path FROM memories))
         OR (kind = 'message' AND ref NOT IN (SELECT id FROM messages))`,
    );
    const e = await model();
    const put = deps.db.prepare(
      'INSERT OR REPLACE INTO embeddings (kind, ref, hash, vector) VALUES (?, ?, ?, ?)',
    );
    for (let rows = pending(200); rows.length; rows = pending(200)) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const vectors = await e.embed(batch.map((r) => r.text.slice(0, MAX_CHARS)));
        batch.forEach((r, j) => {
          const v = vectors[j];
          if (v) put.run(r.kind, r.ref, r.hash, toBlob(v));
        });
        await new Promise((r) => setImmediate(r)); // stay out of the way of chat and voice
      }
    }
  }

  return {
    ready,
    installed,

    /** Embeds whatever is new or changed. Safe to call often: concurrent calls share one run. */
    sync(): Promise<void> {
      if (!ready()) return Promise.resolve();
      syncing ??= syncAll()
        .catch((err: unknown) => log.warn({ err: errorMessage(err) }, 'semantic index sync failed'))
        .finally(() => {
          syncing = null;
        });
      return syncing;
    },

    /** Nearest rows by cosine similarity (vectors are normalised). Brute force over all rows.
     * ponytail: linear scan, fine for tens of thousands of rows; add an ANN index if it ever isn't. */
    async search(
      kind: EmbedKind,
      text: string,
      k: number,
    ): Promise<Array<{ ref: string; score: number }>> {
      if (!ready() || !text.trim()) return [];
      try {
        const [q] = await (await model()).embed([text.slice(0, MAX_CHARS)]);
        if (!q) return [];
        const rows = deps.db
          .prepare('SELECT ref, vector FROM embeddings WHERE kind = ?')
          .all(kind) as Array<{ ref: string; vector: Uint8Array }>;
        return rows
          .map((r) => ({ ref: r.ref, score: dot(q, fromBlob(r.vector)) }))
          .filter((r) => r.score >= MIN_SCORE)
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
      } catch (err) {
        log.warn({ err: errorMessage(err) }, 'semantic search failed; keywords only');
        return [];
      }
    },

    count(): number {
      return (deps.db.prepare('SELECT COUNT(*) AS n FROM embeddings').get() as { n: number }).n;
    },
  };
}

export type SemanticIndex = ReturnType<typeof createSemanticIndex>;

/** Reciprocal-rank fusion of ranked id lists (keyword + semantic). */
export function fuse(lists: string[][], k: number): string[] {
  const score = new Map<string, number>();
  for (const list of lists)
    list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + rank)));
  return [...score]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}
