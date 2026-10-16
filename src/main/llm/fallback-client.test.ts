import { describe, expect, it, vi } from 'vitest';
import { JarvisError } from '../errors';
import { createFallbackClient } from './fallback-client';
import type { LlmClient, LlmMessage } from './types';

const msg = (id: string): LlmMessage => ({ id }) as unknown as LlmMessage;
const req = { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [] };
const live = () => ({ signal: new AbortController().signal });

function client(impl: LlmClient['stream']): LlmClient {
  return { stream: vi.fn(impl), ping: vi.fn(async () => undefined) };
}

function setup(primaryImpl: LlmClient['stream'], enabled = true) {
  const primary = client(primaryImpl);
  const fallback = client(async () => msg('local_1'));
  const onFallback = vi.fn();
  const c = createFallbackClient({ primary, fallback, enabled: () => enabled, onFallback });
  return { c, primary, fallback, onFallback };
}

const busy = () => new JarvisError('LLM_OVERLOADED', 'x', 'busy');

describe('fallback client (ruflo provider failover idea)', () => {
  it('uses Claude when it answers', async () => {
    const { c, fallback } = setup(async () => msg('msg_1'));
    expect((await c.stream(req, live())).id).toBe('msg_1');
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it('answers with the local model when Claude is busy or unreachable', async () => {
    const { c, onFallback } = setup(async () => {
      throw busy();
    });
    expect((await c.stream(req, live())).id).toBe('local_1');
    expect(onFallback).toHaveBeenCalledOnce();
    const net = setup(async () => {
      throw new JarvisError('LLM_NETWORK', 'x', 'offline');
    });
    expect((await net.c.stream(req, live())).id).toBe('local_1');
  });

  it('never falls back when switched off, for a bad key, after text was shown, or when stopped', async () => {
    await expect(
      setup(async () => Promise.reject(busy()), false).c.stream(req, live()),
    ).rejects.toThrow();
    await expect(
      setup(async () => Promise.reject(new JarvisError('LLM_AUTH', 'x', 'key'))).c.stream(
        req,
        live(),
      ),
    ).rejects.toThrow();
    const mid = setup(async (_r, o) => {
      o.onText?.('Hel');
      throw busy();
    });
    await expect(mid.c.stream(req, { ...live(), onText: () => undefined })).rejects.toThrow();
    expect(mid.fallback.stream).not.toHaveBeenCalled();
    const computer = setup(async () => Promise.reject(busy()));
    await expect(
      computer.c.stream(
        { ...req, tools: [{ type: 'computer_toolset_20260801' }] } as never,
        live(),
      ),
    ).rejects.toThrow();
    const picture = setup(async () => Promise.reject(busy()));
    await expect(
      picture.c.stream(
        {
          ...req,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
              ],
            },
          ],
        },
        live(),
      ),
    ).rejects.toThrow();
    expect(picture.fallback.stream).not.toHaveBeenCalled();
    const ac = new AbortController();
    const stopped = setup(async () => {
      ac.abort();
      throw busy();
    });
    await expect(stopped.c.stream(req, { signal: ac.signal })).rejects.toThrow();
  });
});
