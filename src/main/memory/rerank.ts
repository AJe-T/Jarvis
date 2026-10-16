import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage } from '../errors';
import type { Logger } from '../logging/logger';

/**
 * Memory re-ranking (idea from vectorize-io/hindsight, whose recall re-orders fused results with a
 * cross-encoder; code is ours). Keyword and meaning search each guess; a cross-encoder reads the
 * question and each candidate note together and scores how well the note answers it. On this PC,
 * 23 MB, a few milliseconds per note. Off or not downloaded → the fused order is kept.
 */

const MAX_DOC_CHARS = 1200;

export interface CrossEncoder {
  /** One relevance score per document (higher = more relevant). */
  score(query: string, docs: string[]): Promise<number[]>;
}

/** `dir` is models/minilm-rerank (pinned transformers.js layout, verified on download). */
export async function loadCrossEncoder(dir: string): Promise<CrossEncoder> {
  const { env, AutoTokenizer, AutoModelForSequenceClassification } =
    await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '';
  const tokenizer = await AutoTokenizer.from_pretrained(dir);
  const model = await AutoModelForSequenceClassification.from_pretrained(dir, {
    dtype: 'q8',
    device: 'cpu',
  });
  return {
    async score(query, docs) {
      const inputs = tokenizer(
        docs.map(() => query),
        { text_pair: docs, padding: true, truncation: true },
      );
      const out = (await model(inputs)) as { logits: { data: Float32Array } };
      return Array.from(out.logits.data);
    },
  };
}

export function createReranker(deps: {
  modelDir: string;
  enabled(): boolean;
  logger: Logger;
  /** Tests inject a fake. */
  load?(dir: string): Promise<CrossEncoder>;
}) {
  const log = deps.logger.child({ module: 'rerank' });
  let encoder: Promise<CrossEncoder> | null = null;

  const installed = (): boolean =>
    existsSync(join(deps.modelDir, 'onnx', 'model_quantized.onnx')) || !!deps.load;
  const ready = (): boolean => deps.enabled() && installed();

  function model(): Promise<CrossEncoder> {
    if (!encoder) {
      const p = (deps.load ?? loadCrossEncoder)(deps.modelDir);
      p.catch(() => {
        if (encoder === p) encoder = null;
      });
      encoder = p;
    }
    return encoder;
  }

  return {
    ready,
    installed,
    /** The best `k` items for `query`, best first. Falls back to the given order on any failure. */
    async rerank<T>(query: string, items: T[], text: (item: T) => string, k: number): Promise<T[]> {
      if (!ready() || items.length < 2 || !query.trim()) return items.slice(0, k);
      try {
        const scores = await (
          await model()
        ).score(
          query.slice(0, MAX_DOC_CHARS),
          items.map((i) => text(i).slice(0, MAX_DOC_CHARS)),
        );
        return items
          .map((item, i) => ({ item, s: scores[i] ?? Number.NEGATIVE_INFINITY, i }))
          .sort((a, b) => b.s - a.s || a.i - b.i)
          .slice(0, k)
          .map((x) => x.item);
      } catch (err) {
        log.warn({ err: errorMessage(err) }, 'rerank failed; keeping the fused order');
        return items.slice(0, k);
      }
    },
  };
}

export type Reranker = ReturnType<typeof createReranker>;
