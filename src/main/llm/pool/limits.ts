/**
 * AI Router Phase 3: what a free search or image service's failure means, learned from its reply
 * the way the chat pool learns (pool.ts learnFailure). Monthly or one-off credits can't be read
 * from a reply, so "out of credit" pauses a day and is tried again then.
 */

export interface Pause {
  until: number;
  reason: string;
  strikes: number;
}

/** 429 without a hint: 1 min, then 5, then 30. */
const LADDER_MS = [60_000, 300_000, 1_800_000];
const DAY_MS = 86_400_000;

export function pauseFor(
  reply: { status?: number | undefined; headers?: Headers | undefined; text?: string },
  prev: Pause | undefined,
  now: number,
): Pause {
  const { status } = reply;
  const lower = (reply.text ?? '').toLowerCase();
  const strikes = (prev?.strikes ?? 0) + 1;
  const pause = (ms: number, reason: string): Pause => ({ until: now + ms, reason, strikes });
  const outOfCredit = /credit|quota|plan limit|usage limit|exceeded|per month|monthly/.test(lower);
  // Tavily: 432 = plan limit, 433 = pay-as-you-go limit; 402 = payment needed (Pollinations, Linkup).
  if (status === 402 || status === 432 || status === 433) {
    const after = Number(reply.headers?.get('retry-after'));
    return after > 0 && after < 3600
      ? pause(after * 1000, 'busy, try again shortly')
      : pause(DAY_MS, 'out of free credit');
  }
  if (status === 429) {
    const after = Number(reply.headers?.get('retry-after'));
    if (after > 0) return pause(Math.min(after, 86_400) * 1000, 'rate limited');
    if (outOfCredit) return pause(DAY_MS, 'out of free credit');
    return pause(LADDER_MS[Math.min(strikes - 1, LADDER_MS.length - 1)] as number, 'rate limited');
  }
  if (status === 401 || status === 403) return pause(6 * 3_600_000, 'key rejected');
  if (status && status >= 400 && status < 500) return pause(1_800_000, `refused (${status})`);
  return pause(120_000, status ? `server error ${status}` : 'unreachable');
}

/** Cooldowns by service id, shared shape for search and images. */
export function createPauses(now: () => number) {
  const pauses = new Map<string, Pause>();
  return {
    active(id: string): Pause | undefined {
      const p = pauses.get(id);
      return p && p.until > now() ? p : undefined;
    },
    fail(id: string, reply: Parameters<typeof pauseFor>[0]): string {
      const p = pauseFor(reply, pauses.get(id), now());
      pauses.set(id, p);
      return p.reason;
    },
    ok(id: string): void {
      pauses.delete(id);
    },
    clear: (): void => pauses.clear(),
  };
}
export type Pauses = ReturnType<typeof createPauses>;
