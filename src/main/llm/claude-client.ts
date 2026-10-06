import Anthropic from '@anthropic-ai/sdk';
import { JarvisError } from '../errors';
import type { LlmClient, LlmMessage, LlmRequest, StreamOptions } from './types';

const STREAM_IDLE_MS = 30_000;

/** API-Guide.md §3.7: turn SDK errors into JarvisErrors with Sir-facing messages. */
export function mapClaudeError(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  )
    return new JarvisError(
      'LLM_AUTH',
      err.message,
      'Claude rejected the API key. Open Settings → Brain to replace it.',
      { cause: err },
    );
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError)
    return new JarvisError(
      'LLM_OVERLOADED',
      err.message,
      'Claude is busy right now. Try again in a moment.',
      { cause: err },
    );
  if (err instanceof Anthropic.BadRequestError)
    return new JarvisError(
      'LLM_BAD_REQUEST',
      err.message,
      'Claude rejected the request (a bug on my side). Details are in the log.',
      { cause: err },
    );
  if (err instanceof Anthropic.APIConnectionError)
    return new JarvisError(
      'LLM_NETWORK',
      err.message,
      "Couldn't reach Claude. Check your internet connection.",
      { cause: err },
    );
  if (err instanceof Anthropic.APIError && err.status === 529)
    return new JarvisError(
      'LLM_OVERLOADED',
      err.message,
      'Claude is busy right now. Try again in a moment.',
      { cause: err },
    );
  return err;
}

export function createClaudeClient(getApiKey: () => string | undefined): LlmClient {
  let cached: { key: string; client: Anthropic } | null = null;

  function client(): Anthropic {
    const key = getApiKey();
    if (!key)
      throw new JarvisError(
        'LLM_NO_KEY',
        'No Anthropic key',
        'Add your Anthropic API key in Settings → Brain first.',
      );
    if (cached?.key !== key)
      cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 3, timeout: 120_000 }) };
    return cached.client;
  }

  async function streamOnce(
    req: LlmRequest,
    opts: StreamOptions,
    state: { sawText: boolean },
  ): Promise<LlmMessage> {
    const idle = new AbortController();
    const onOuterAbort = (): void => idle.abort(opts.signal.reason);
    opts.signal.addEventListener('abort', onOuterAbort, { once: true });
    let timer = setTimeout(() => idle.abort(new Error('stream idle')), STREAM_IDLE_MS);
    try {
      const stream = client().messages.stream(req, { signal: idle.signal });
      stream.on('streamEvent', () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(new Error('stream idle')), STREAM_IDLE_MS);
      });
      stream.on('text', (delta) => {
        state.sawText = true;
        opts.onText?.(delta);
      });
      return await stream.finalMessage();
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onOuterAbort);
    }
  }

  return {
    async stream(req, opts) {
      const state = { sawText: false };
      try {
        return await streamOnce(req, opts, state);
      } catch (err) {
        // Stream idle > 30 s: abort and retry once, unless text already reached the UI.
        const idleAbort = !opts.signal.aborted && err instanceof Anthropic.APIUserAbortError;
        if (idleAbort && !state.sawText) {
          try {
            return await streamOnce(req, opts, state);
          } catch (retryErr) {
            throw mapClaudeError(retryErr);
          }
        }
        if (idleAbort)
          throw new JarvisError(
            'LLM_NETWORK',
            'stream idle',
            'The connection to Claude stalled. Please try again.',
          );
        throw mapClaudeError(err);
      }
    },
    async ping(model, signal) {
      try {
        await client().messages.create(
          { model, max_tokens: 5, messages: [{ role: 'user', content: 'Reply OK' }] },
          { signal, maxRetries: 0 },
        );
      } catch (err) {
        throw mapClaudeError(err);
      }
    },
  };
}
