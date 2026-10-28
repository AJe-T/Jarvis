import { describe, expect, it } from 'vitest';
import type { Logger } from '../../logging/logger';
import type { WakeWord } from '../types';
import { createAudioWorker, MAX_WAKE_BACKLOG, type AudioLink } from './client';
import { createAudioHost } from './host-core';
import type { FromWorker, ToWorker } from './protocol';

const quiet = {
  child: () => quiet,
  info: () => undefined,
  warn: () => undefined,
} as unknown as Logger;

/** A wake engine that "hears" frames starting with 1, answering after `delayMs`. */
function fakeWake(delayMs = 0): WakeWord & { resets: number; released: boolean } {
  return {
    frameLength: 1280,
    resets: 0,
    released: false,
    process: async (frame) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return frame[0] === 1;
    },
    reset() {
      this.resets++;
    },
    release() {
      this.released = true;
    },
  };
}

/** The worker in this process: messages cross a microtask, like they cross a process boundary. */
function inProcess(opts: { wake?: WakeWord; stall?: boolean } = {}) {
  const wake = opts.wake ?? fakeWake();
  let exit: ((why: string) => void) | null = null;
  let connects = 0;
  const seen: ToWorker[] = [];
  const connect = async (): Promise<AudioLink> => {
    connects++;
    let toMain: ((m: FromWorker) => void) | null = null;
    const host = createAudioHost((m) => queueMicrotask(() => toMain?.(m)), {
      openWake: async (spec) => {
        if (spec.engine === 'spotter' && spec.phrases.length === 0) throw new Error('no phrases');
        return wake;
      },
      openVad: async () => ({ prob: async (w) => w[0] ?? 0, reset: () => undefined }),
    });
    return {
      post: (m) => {
        seen.push(m);
        if (opts.stall && m.t === 'wake-frame') return; // a worker that has fallen behind
        queueMicrotask(() => host(m));
      },
      onMessage: (cb) => {
        toMain = cb;
      },
      onExit: (cb) => {
        exit = cb;
      },
      kill: () => exit?.('killed'),
    };
  };
  const worker = createAudioWorker({ logger: quiet, connect });
  return { worker, wake, seen, crash: (why: string) => exit?.(why), connects: () => connects };
}

const spec = { engine: 'openwakeword', dir: 'models/oww', threshold: 0.5 } as const;
const frame = (first: number): Int16Array => Int16Array.from([first, 0, 0]);

describe('audio worker (voice fix 1B)', () => {
  it('answers wake frames in order without the caller waiting on inference', async () => {
    const t = inProcess({ wake: fakeWake(5) });
    const w = await t.worker.wake(spec);
    expect(w.frameLength).toBe(1280);
    const answers = [w.process(frame(0)), w.process(frame(1)), w.process(frame(0))] as Array<
      Promise<boolean>
    >;
    expect(answers.every((a) => a instanceof Promise)).toBe(true); // posted, not computed here
    expect(await Promise.all(answers)).toEqual([false, true, false]);
  });

  it('reports inference time and forwards reset and release to the worker engine', async () => {
    const t = inProcess();
    const times: number[] = [];
    const w = await t.worker.wake(spec, { onTiming: (ms) => times.push(ms) });
    await w.process(frame(0));
    w.reset();
    w.release();
    await new Promise((r) => setTimeout(r, 10));
    expect(times).toHaveLength(1);
    expect((t.wake as ReturnType<typeof fakeWake>).resets).toBe(1);
    expect((t.wake as ReturnType<typeof fakeWake>).released).toBe(true);
  });

  it('drops (and counts) wake frames once the worker is 2 s behind instead of queueing forever', async () => {
    const t = inProcess({ stall: true });
    let dropped = 0;
    const w = await t.worker.wake(spec, { onBacklog: () => dropped++ });
    for (let i = 0; i < MAX_WAKE_BACKLOG + 5; i++) void w.process(frame(0));
    expect(dropped).toBe(5);
    expect(t.seen.filter((m) => m.t === 'wake-frame')).toHaveLength(MAX_WAKE_BACKLOG);
  });

  it('a crashed worker fails its engines and is started again on the next open', async () => {
    const t = inProcess({ stall: true });
    let crashed = 0;
    t.worker.onCrash(() => crashed++);
    const w = await t.worker.wake(spec);
    const pending = w.process(frame(1));
    t.crash('exit 3221225477');
    await expect(pending).rejects.toThrow(/audio worker stopped/);
    await expect(w.process(frame(1))).rejects.toThrow(/audio worker stopped/);
    expect(crashed).toBe(1);
    await t.worker.wake(spec);
    expect(t.connects()).toBe(2);
  });

  it('a model that fails to load rejects the open', async () => {
    const t = inProcess();
    await expect(
      t.worker.wake({ engine: 'spotter', dir: 'models/kws', phrases: [], threshold: 0.2 }),
    ).rejects.toThrow('no phrases');
  });

  it('runs the voice detector remotely', async () => {
    const t = inProcess();
    const vad = await t.worker.vad('models/silero/silero_vad.onnx');
    expect(await vad.prob(Float32Array.from([0.75]))).toBe(0.75);
    vad.release();
    expect(await vad.prob(Float32Array.from([0.75]))).toBe(0); // closed: answers silence
  });
});
