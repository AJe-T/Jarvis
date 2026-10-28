import { describe, expect, it } from 'vitest';
import type { VoiceStatus } from '@shared/ipc-contract';
import type { Logger } from '../logging/logger';
import { CAPTURE_RETRY_MS, createMicSupervisor, type CaptureStarted } from './mic-supervisor';

const quiet = { child: () => quiet, info: () => undefined } as unknown as Logger;

function setup(opts: { busy?: () => boolean } = {}) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const calls = { restarts: 0, resets: 0, learned: [] as string[] };
  const notes: string[] = [];
  const statuses: VoiceStatus[] = [];
  let broken = false;
  const mic = createMicSupervisor({
    capture: {
      reset: () => {
        calls.resets++;
        broken = false;
      },
      broken: () => broken,
    },
    echoCancel: () => true,
    busy: opts.busy ?? (() => false),
    restart: () => calls.restarts++,
    learnDevice: (id) => calls.learned.push(id),
    emit: (s) => statuses.push(s),
    notify: (_l, m) => notes.push(m),
    logger: quiet,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => undefined,
  });
  /** Runs the newest pending timer. */
  const tick = (): number => {
    const t = timers.pop();
    t?.fn();
    return t?.ms ?? -1;
  };
  const fail = (why = 'NotReadableError') => {
    broken = true;
    mic.broken(why);
  };
  return { mic, calls, notes, statuses, timers, tick, fail, last: () => statuses.at(-1)?.mic };
}

const opened = (over: Partial<CaptureStarted> = {}): CaptureStarted => ({
  match: 'matched',
  requestedLabel: 'Microphone (USB)',
  label: 'Microphone (USB) (046d:0825)',
  deviceId: 'abc123',
  inputs: [{ deviceId: 'abc123', label: 'Microphone (USB) (046d:0825)' }],
  ...over,
});

describe('microphone supervisor (voice fix 1A)', () => {
  it('falls back to the native mic at once, then retries the echo-cancelled one after 1 s, 3 s, 10 s', () => {
    const t = setup();
    t.fail();
    expect(t.calls.restarts).toBe(1); // native recorder now
    expect(t.last()).toMatchObject({ source: 'native', state: 'retrying', retryInMs: 1000 });
    const waits: number[] = [];
    for (let i = 0; i < CAPTURE_RETRY_MS.length; i++) {
      waits.push(t.tick()); // retry: capture reset + reopen
      expect(t.last()?.source).toBe('echo');
      t.fail(); // fails again
    }
    expect(waits).toEqual([1000, 3000, 10_000]);
    expect(t.calls.resets).toBe(3);
    expect(t.last()).toMatchObject({ state: 'failed', retryInMs: null });
    expect(t.timers).toHaveLength(0); // gave up: no more retries
    expect(t.notes.at(-1)).toMatch(/Try again/);
  });

  it('never swaps microphones while Sir or Jarvis is talking', () => {
    let busy = true;
    const t = setup({ busy: () => busy });
    t.fail();
    t.tick();
    expect(t.calls.resets).toBe(0);
    expect(t.timers).toHaveLength(1); // checks again shortly
    busy = false;
    t.tick();
    expect(t.calls.resets).toBe(1);
  });

  it('recovering resets the backoff and says so; Try again starts over after giving up', () => {
    const t = setup();
    t.fail();
    t.tick();
    t.mic.started(opened());
    expect(t.notes.at(-1)).toMatch(/working again/);
    expect(t.last()).toMatchObject({
      source: 'echo',
      state: 'ok',
      device: 'Microphone (USB) (046d:0825)',
    });
    for (let i = 0; i <= CAPTURE_RETRY_MS.length; i++) {
      t.fail();
      t.tick();
    }
    t.mic.retry();
    expect(t.last()).toMatchObject({ source: 'echo', state: 'idle' });
    t.fail();
    expect(t.last()).toMatchObject({ state: 'retrying', retryInMs: 1000 });
  });

  it('learns the Chromium id of a matched device and warns once when the chosen one is missing', () => {
    const t = setup();
    t.mic.started(opened());
    expect(t.calls.learned).toEqual(['abc123']);
    const missing = opened({ match: 'fallback', label: 'Default - Realtek', deviceId: 'def' });
    t.mic.started(missing);
    t.mic.started(missing);
    expect(t.calls.learned).toEqual(['abc123']); // the default is never learned
    expect(t.notes.filter((n) => /couldn't find/.test(n))).toHaveLength(1);
    expect(t.last()).toMatchObject({ deviceMismatch: true });
    t.mic.useDevice('xyz');
    expect(t.calls.learned).toEqual(['abc123', 'xyz']);
    expect(t.calls.restarts).toBe(1);
  });
});
