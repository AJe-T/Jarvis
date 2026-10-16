import { describe, expect, it } from 'vitest';
import { logger } from '../logging/logger';
import { createReranker } from './rerank';

const encoder = (scores: Record<string, number>) => async () => ({
  score: async (_q: string, docs: string[]) => docs.map((d) => scores[d] ?? 0),
});

describe('memory re-ranking (idea from hindsight)', () => {
  it('orders candidates by the cross-encoder score and keeps k', async () => {
    const r = createReranker({
      modelDir: 'unused',
      enabled: () => true,
      logger,
      load: encoder({ wedding: 9, rust: 1, cats: 5 }),
    });
    expect(await r.rerank('my sister’s wedding', ['rust', 'cats', 'wedding'], (x) => x, 2)).toEqual(
      ['wedding', 'cats'],
    );
  });

  it('keeps the fused order when turned off or when the model fails', async () => {
    const off = createReranker({
      modelDir: 'unused',
      enabled: () => false,
      logger,
      load: encoder({ b: 9 }),
    });
    expect(await off.rerank('q', ['a', 'b', 'c'], (x) => x, 2)).toEqual(['a', 'b']);
    const broken = createReranker({
      modelDir: 'unused',
      enabled: () => true,
      logger,
      load: () => Promise.reject(new Error('no onnx')),
    });
    expect(await broken.rerank('q', ['a', 'b', 'c'], (x) => x, 2)).toEqual(['a', 'b']);
  });
});
