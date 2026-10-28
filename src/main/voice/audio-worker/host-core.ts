import type { Vad } from '../local/onnx';
import type { WakeWord } from '../types';
import type { createAudioEngines } from './engines';
import type { FromWorker, ToWorker } from './protocol';

type Entry = { kind: 'wake'; wake: WakeWord } | { kind: 'vad'; vad: Vad };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The audio worker's message handler (voice fix 1B). Each engine handles its messages strictly in
 * order on its own chain, so frames, resets and the close never overlap; engines don't wait on each
 * other beyond sharing this process's one JS thread.
 */
export function createAudioHost(
  post: (m: FromWorker) => void,
  engines: Pick<ReturnType<typeof createAudioEngines>, 'openWake' | 'openVad'>,
) {
  const entries = new Map<number, Promise<Entry | null>>();
  const chains = new Map<number, Promise<void>>();

  function queue(id: number, fn: (e: Entry) => Promise<void> | void): void {
    const run = (chains.get(id) ?? Promise.resolve())
      .then(async () => {
        const e = await entries.get(id);
        if (e) await fn(e);
      })
      .catch((err: unknown) => post({ t: 'error', id, error: message(err) }));
    chains.set(id, run);
  }

  function open(id: number, load: () => Promise<Entry>, frameLength: (e: Entry) => number): void {
    entries.set(
      id,
      load().then(
        (e) => {
          post({ t: 'opened', id, frameLength: frameLength(e) });
          return e;
        },
        (err: unknown) => {
          post({ t: 'open-failed', id, error: message(err) });
          return null;
        },
      ),
    );
  }

  return (m: ToWorker): void => {
    switch (m.t) {
      case 'wake-open':
        return open(
          m.id,
          async () => ({ kind: 'wake', wake: await engines.openWake(m.spec) }),
          (e) => (e.kind === 'wake' ? e.wake.frameLength : 0),
        );
      case 'vad-open':
        return open(
          m.id,
          async () => ({ kind: 'vad', vad: await engines.openVad(m.path) }),
          () => 512,
        );
      case 'wake-frame':
        return queue(m.id, async (e) => {
          if (e.kind !== 'wake') return;
          const started = performance.now();
          const heard = await e.wake.process(m.frame);
          post({ t: 'wake', id: m.id, heard, ms: performance.now() - started });
        });
      case 'wake-reset':
        return queue(m.id, (e) => {
          if (e.kind === 'wake') e.wake.reset();
        });
      case 'vad-prob':
        return queue(m.id, async (e) => {
          if (e.kind !== 'vad') return;
          const started = performance.now();
          const p = await e.vad.prob(m.window);
          post({ t: 'prob', id: m.id, p, ms: performance.now() - started });
        });
      case 'vad-reset':
        return queue(m.id, (e) => {
          if (e.kind === 'vad') e.vad.reset();
        });
      case 'close':
        queue(m.id, (e) => {
          if (e.kind === 'wake') e.wake.release();
        });
        void chains.get(m.id)?.finally(() => {
          entries.delete(m.id);
          chains.delete(m.id);
        });
        return;
    }
  };
}
