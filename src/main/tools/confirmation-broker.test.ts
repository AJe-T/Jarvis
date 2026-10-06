import { describe, expect, it, vi } from 'vitest';
import { createConfirmationBroker, type ConfirmInput } from './confirmation-broker';

const input = (over: Partial<ConfirmInput> = {}): ConfirmInput => ({
  toolName: 't',
  title: 'Do it?',
  humanSummary: 'Do it',
  details: 'x',
  detailsKind: 'text',
  actionLabel: 'Do it',
  destructive: false,
  ...over,
});

function setup(timeoutMs = 120_000) {
  const shown: Array<{ requestId: string; queueTotal: number }> = [];
  const resolved: string[] = [];
  const broker = createConfirmationBroker({
    emit: (_e, p) => shown.push(p),
    emitResolved: (p) => resolved.push(`${p.requestId}:${p.decision}`),
    timeoutMs,
  });
  return { broker, shown, resolved };
}

describe('confirmation broker', () => {
  it('shows one request at a time, in order', async () => {
    const { broker, shown } = setup();
    const signal = new AbortController().signal;
    const a = broker.request(input({ title: 'A' }), signal);
    const b = broker.request(input({ title: 'B' }), signal);
    expect(shown).toHaveLength(1);
    expect(broker.size()).toBe(2);
    expect(broker.respond(shown[0]?.requestId ?? '', 'approve', 'click')).toBe(true);
    await expect(a).resolves.toEqual({ decision: 'approve', decidedBy: 'user_click' });
    expect(shown).toHaveLength(2);
    broker.respond(shown[1]?.requestId ?? '', 'deny', 'keyboard');
    await expect(b).resolves.toEqual({ decision: 'deny', decidedBy: 'user_click' });
  });

  it('only answers the request currently on screen', () => {
    const { broker, shown } = setup();
    const s = new AbortController().signal;
    void broker.request(input(), s);
    void broker.request(input(), s);
    expect(broker.respond('nope', 'approve', 'click')).toBe(false);
    expect(broker.current()?.id).toBe(shown[0]?.requestId);
  });

  it('refuses voice approval for destructive actions but accepts voice denial', async () => {
    const { broker, shown } = setup();
    const p = broker.request(input({ destructive: true }), new AbortController().signal);
    const id = shown[0]?.requestId ?? '';
    expect(broker.respond(id, 'approve', 'voice')).toBe(false);
    expect(broker.respond(id, 'deny', 'voice')).toBe(true);
    await expect(p).resolves.toEqual({ decision: 'deny', decidedBy: 'user_voice' });
  });

  it('accepts voice approval for non-destructive actions', async () => {
    const { broker, shown } = setup();
    const p = broker.request(input(), new AbortController().signal);
    broker.respond(shown[0]?.requestId ?? '', 'approve', 'voice');
    await expect(p).resolves.toEqual({ decision: 'approve', decidedBy: 'user_voice' });
  });

  it('denies after the timeout', async () => {
    vi.useFakeTimers();
    const { broker, resolved } = setup(1000);
    const p = broker.request(input(), new AbortController().signal);
    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toEqual({ decision: 'deny', decidedBy: 'timeout' });
    expect(resolved[0]).toMatch(/:deny$/);
    vi.useRealTimers();
  });

  it('denies on abort (kill switch), including requests already aborted', async () => {
    const { broker } = setup();
    const c = new AbortController();
    const p = broker.request(input(), c.signal);
    c.abort();
    await expect(p).resolves.toEqual({ decision: 'deny', decidedBy: 'kill_switch' });
    await expect(broker.request(input(), c.signal)).resolves.toEqual({
      decision: 'deny',
      decidedBy: 'kill_switch',
    });
  });

  it('denyAll clears the queue', async () => {
    const { broker } = setup();
    const s = new AbortController().signal;
    const all = [broker.request(input(), s), broker.request(input(), s)];
    broker.denyAll();
    expect((await Promise.all(all)).map((r) => r.decision)).toEqual(['deny', 'deny']);
    expect(broker.size()).toBe(0);
    expect(broker.current()).toBeNull();
  });
});
