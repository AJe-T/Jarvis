import { constants, setPriority } from 'node:os';
import type { Logger } from '../../logging/logger';
import type { Vad } from '../local/onnx';
import type { WakeWord } from '../types';
import type { FromWorker, ToWorker, WakeSpec } from './protocol';

/** How long a model may take to load in the worker before the open fails. */
const OPEN_TIMEOUT_MS = 60_000;
/**
 * Wake frames waiting for an answer before new ones are dropped (25 × 80 ms = 2 s): a worker that
 * can't keep up must not build an ever-growing queue. Each drop is counted (diagnostics 'backlog').
 */
export const MAX_WAKE_BACKLOG = 25;

/** The pipe to the worker: a utility process in the app, the host itself in tests. */
export interface AudioLink {
  post(m: ToWorker): void;
  onMessage(cb: (m: FromWorker) => void): void;
  onExit(cb: (why: string) => void): void;
  kill(): void;
}

export interface WakeHooks {
  /** Inference time of one frame in the worker. */
  onTiming?(ms: number): void;
  /** A frame dropped because the worker is behind. */
  onBacklog?(): void;
}

type Waiter = { resolve(v: never): void; reject(e: Error): void };

interface Engine {
  fifo: Waiter[];
  broken: Error | null;
  closed: boolean;
  onTiming?: ((ms: number) => void) | undefined;
}

/**
 * Voice fix 1B: the main-process side of the audio worker. Wake words and voice detectors opened
 * here look like local ones (WakeWord, Vad) but run in the worker; process() and prob() only post a
 * message and resolve when the answer comes back, so the mic loop never waits on inference. A
 * crashed worker fails its engines (the voice controller reopens them) and is started again on the
 * next open.
 */
export function createAudioWorker(opts: { logger: Logger; connect(): Promise<AudioLink> }) {
  const log = opts.logger.child({ module: 'voice.worker' });
  let link: Promise<AudioLink> | null = null;
  let nextId = 1;
  const engines = new Map<number, Engine>();
  const opening = new Map<number, { resolve(frameLength: number): void; reject(e: Error): void }>();
  const crashListeners = new Set<() => void>();

  function failAll(why: string): void {
    const err = new Error(why);
    for (const o of opening.values()) o.reject(err);
    opening.clear();
    for (const e of engines.values()) {
      e.broken = err;
      for (const w of e.fifo.splice(0)) w.reject(err);
    }
    engines.clear();
  }

  function onMessage(m: FromWorker): void {
    if (m.t === 'log') {
      if (m.level === 'warn') log.warn(m.obj, m.msg);
      else log.info(m.obj, m.msg);
      return;
    }
    if (m.t === 'opened' || m.t === 'open-failed') {
      const o = opening.get(m.id);
      opening.delete(m.id);
      if (m.t === 'opened') o?.resolve(m.frameLength);
      else o?.reject(new Error(m.error));
      return;
    }
    const e = engines.get(m.id);
    if (!e) return;
    if (m.t === 'error') {
      e.broken = new Error(m.error);
      for (const w of e.fifo.splice(0)) w.reject(e.broken);
      return;
    }
    e.onTiming?.(m.ms);
    const w = e.fifo.shift();
    if (m.t === 'wake') (w?.resolve as ((v: boolean) => void) | undefined)?.(m.heard);
    else (w?.resolve as ((v: number) => void) | undefined)?.(m.p);
  }

  function connected(): Promise<AudioLink> {
    link ??= opts.connect().then(
      (l) => {
        l.onMessage(onMessage);
        l.onExit((why) => {
          link = null;
          log.warn({ why }, 'audio worker stopped');
          failAll('The audio worker stopped.');
          for (const c of crashListeners) c();
        });
        return l;
      },
      (err: unknown) => {
        link = null;
        throw err;
      },
    );
    return link;
  }

  async function open(msg: ToWorker & { id: number }, onTiming?: (ms: number) => void) {
    const l = await connected();
    const frameLength = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!opening.delete(msg.id)) return;
        reject(new Error('The audio worker took too long to load the model.'));
      }, OPEN_TIMEOUT_MS);
      opening.set(msg.id, {
        resolve: (n) => {
          clearTimeout(timer);
          resolve(n);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      l.post(msg);
    });
    const engine: Engine = { fifo: [], broken: null, closed: false, onTiming };
    engines.set(msg.id, engine);
    return { l, engine, frameLength };
  }

  function ask<T>(l: AudioLink, e: Engine, msg: ToWorker): Promise<T> {
    if (e.broken) return Promise.reject(e.broken);
    return new Promise<T>((resolve, reject) => {
      e.fifo.push({ resolve, reject });
      l.post(msg);
    });
  }

  function close(l: AudioLink, id: number, e: Engine, answer: unknown): void {
    if (e.closed) return;
    e.closed = true;
    for (const w of e.fifo.splice(0)) (w.resolve as (v: unknown) => void)(answer);
    engines.delete(id);
    if (!e.broken) l.post({ t: 'close', id });
  }

  return {
    async wake(spec: WakeSpec, hooks: WakeHooks = {}): Promise<WakeWord> {
      const id = nextId++;
      const { l, engine, frameLength } = await open({ t: 'wake-open', id, spec }, hooks.onTiming);
      return {
        frameLength,
        process(frame) {
          if (engine.closed) return Promise.resolve(false);
          if (!engine.broken && engine.fifo.length >= MAX_WAKE_BACKLOG) {
            hooks.onBacklog?.();
            return Promise.resolve(false);
          }
          return ask<boolean>(l, engine, { t: 'wake-frame', id, frame });
        },
        reset: () => {
          if (!engine.closed && !engine.broken) l.post({ t: 'wake-reset', id });
        },
        release: () => close(l, id, engine, false),
      };
    },

    async vad(path: string, onTiming?: (ms: number) => void): Promise<Vad & { release(): void }> {
      const id = nextId++;
      const { l, engine } = await open({ t: 'vad-open', id, path }, onTiming);
      return {
        prob: (window) =>
          engine.closed
            ? Promise.resolve(0)
            : ask<number>(l, engine, { t: 'vad-prob', id, window }),
        reset: () => {
          if (!engine.closed && !engine.broken) l.post({ t: 'vad-reset', id });
        },
        release: () => close(l, id, engine, 0),
      };
    },

    /** The worker died: engines opened before are gone (the voice system reopens them). */
    onCrash(listener: () => void): void {
      crashListeners.add(listener);
    },

    shutdown(): void {
      void link?.then((l) => l.kill()).catch(() => undefined);
      link = null;
    },
  };
}

export type AudioWorker = ReturnType<typeof createAudioWorker>;

/** The worker as an Electron utility process at above-normal priority (it is real-time audio). */
export async function utilityLink(hostFile: string, logger: Logger): Promise<AudioLink> {
  const { utilityProcess } = await import('electron');
  const c = utilityProcess.fork(hostFile, [], {
    serviceName: 'Jarvis audio',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  c.on('spawn', () => {
    try {
      if (c.pid) setPriority(c.pid, constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch (err) {
      logger.warn({ err: String(err) }, 'could not raise the audio worker priority');
    }
  });
  // A native crash prints here; the pipe must be read or the worker would block on a full buffer.
  c.stderr?.on('data', (d: Buffer) =>
    logger.warn({ stderr: d.toString('utf8').slice(0, 2000) }, 'audio worker stderr'),
  );
  return {
    post: (m) => c.postMessage(m),
    onMessage: (cb) => c.on('message', cb),
    onExit: (cb) => {
      c.on('exit', (code) => cb(`exit ${code}`));
    },
    kill: () => void c.kill(),
  };
}
