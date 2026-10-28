import { z } from 'zod';
import { cloudProvider } from '@shared/llm-providers';

/**
 * OpenRouter's GET /api/v1/key (⚠️ checked 2026-10-28, openrouter.ai/docs/api-reference/limits):
 * `free_model_daily_requests` = { used, limit, remaining } for the current UTC day, across every
 * :free model. The only provider that tells us the live count, so AI Router → Usage trusts it.
 * Read-only, no tokens used; the address is the catalogue's fixed one.
 */
const KeyInfo = z.object({
  data: z.object({
    free_model_daily_requests: z
      .object({ used: z.number().int().min(0), limit: z.number().int().min(0) })
      .nullish(),
  }),
});

export async function readOpenRouterKey(
  fetchFn: typeof fetch,
  key: string,
  signal: AbortSignal,
): Promise<{ used: number; limit: number } | null> {
  const res = await fetchFn(`${cloudProvider('openrouter').baseUrl}/key`, {
    headers: { authorization: `Bearer ${key}` },
    redirect: 'error',
    signal,
  });
  if (!res.ok) return null;
  const parsed = KeyInfo.safeParse(await res.json());
  return parsed.success ? (parsed.data.data.free_model_daily_requests ?? null) : null;
}
