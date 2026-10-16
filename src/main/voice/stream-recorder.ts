import type { Recorder } from './types';

/** About 6 s of 512-sample frames; older frames are dropped if nobody reads them. */
const MAX_QUEUE = 200;

/**
 * A Recorder fed with frames from elsewhere (the capture window's echo-cancelled microphone) instead
 * of a device it opens itself. read() waits for the next frame; stop/release end a pending read
 * (the voice controller's loop then ends quietly), and fail() ends it with the reason.
 */
export function createStreamRecorder(opts: {
  frameLength: number;
  onStart(): void;
  onStop(): void;
}): Recorder & { push(frame: Int16Array): void; fail(err: Error): void } {
  const queue: Int16Array[] = [];
  let waiter: { resolve(f: Int16Array): void; reject(e: Error): void } | null = null;
  let failed: Error | null = null;
  let recording = false;

  const settle = (err: Error): void => {
    const w = waiter;
    waiter = null;
    w?.reject(err);
  };
  const end = (): void => {
    if (!recording) return;
    recording = false;
    queue.length = 0;
    opts.onStop();
    settle(new Error('stopped'));
  };

  return {
    frameLength: opts.frameLength,
    start() {
      if (recording) return;
      recording = true;
      opts.onStart();
    },
    stop: end,
    release: end,
    read() {
      if (failed) return Promise.reject(failed);
      const next = queue.shift();
      if (next) return Promise.resolve(next);
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    get isRecording() {
      return recording;
    },
    push(frame) {
      if (!recording) return;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w.resolve(frame);
        return;
      }
      queue.push(frame);
      if (queue.length > MAX_QUEUE) queue.shift();
    },
    fail(err) {
      failed = err;
      settle(err);
    },
  };
}
