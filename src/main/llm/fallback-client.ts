import { JarvisError } from '../errors';
import type { LlmClient, LlmMessage, LlmRequest, StreamOptions } from './types';

/** Errors where trying another brain helps: Claude overloaded or unreachable (not a bad key or request). */
export function isFallbackError(err: unknown): boolean {
  return (
    err instanceof JarvisError && (err.code === 'LLM_OVERLOADED' || err.code === 'LLM_NETWORK')
  );
}

/** Computer control and pictures need Claude: a local model would answer them badly, so they never fall back. */
export function canFallback(req: LlmRequest): boolean {
  const computer = (req.tools ?? []).some(
    (t) => 'type' in t && String(t.type).startsWith('computer'),
  );
  const image = req.messages.some(
    (m) => typeof m.content !== 'string' && m.content.some((b) => b.type === 'image'),
  );
  return !computer && !image;
}

/**
 * Provider failover (idea from ruflo's provider manager): Claude first; if it is busy or unreachable
 * before any text was shown, the local model answers that call instead. Text already on screen is
 * never mixed with a second model's answer, and a stopped turn is never retried.
 */
export function createFallbackClient(deps: {
  primary: LlmClient;
  fallback: LlmClient;
  enabled: () => boolean;
  onFallback: (err: JarvisError) => void;
}): LlmClient {
  return {
    async stream(req: LlmRequest, opts: StreamOptions): Promise<LlmMessage> {
      if (!deps.enabled() || !canFallback(req)) return deps.primary.stream(req, opts);
      let streamed = false;
      const onText = opts.onText;
      try {
        return await deps.primary.stream(req, {
          ...opts,
          ...(onText
            ? {
                onText: (d: string) => {
                  streamed = true;
                  onText(d);
                },
              }
            : {}),
        });
      } catch (err) {
        if (streamed || opts.signal.aborted || !isFallbackError(err)) throw err;
        deps.onFallback(err as JarvisError);
        return deps.fallback.stream(req, opts);
      }
    },
    ping: (model, signal) => deps.primary.ping(model, signal),
  };
}
