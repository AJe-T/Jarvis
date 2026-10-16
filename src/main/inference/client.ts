import { existsSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import type { UtilityProcess } from 'electron';
import { logger } from '../logging/logger';
import type { InferenceOps } from './engines';

/**
 * ADR-029: the main-process side of the inference host. In the Electron main process the models
 * run in a utility process at below-normal priority, so a long transcription or a spoken sentence
 * never freezes windows, IPC or the UI. Elsewhere (Vitest, plain Node) they run in-process.
 * A crashed host is started again on the next request; requests in flight fail and their callers
 * fall back as they do for any model error.
 */

type Pending = { resolve(v: unknown): void; reject(e: Error): void };

const log = logger.child({ module: 'inference' });
const HOST_FILE = join(__dirname, 'inference-host.js');
/** Longest a request may take, including a first model load (Laya: hash + load of 1.2 GB). */
const REQUEST_TIMEOUT_MS = 180_000;

function remoteOps(): InferenceOps {
  let child: Promise<UtilityProcess> | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function failAll(why: string): void {
    for (const p of pending.values()) p.reject(new Error(why));
    pending.clear();
  }

  async function start(): Promise<UtilityProcess> {
    const { utilityProcess } = await import('electron');
    const c = utilityProcess.fork(HOST_FILE, [], {
      serviceName: 'Jarvis models',
      stdio: 'ignore',
    });
    c.on('spawn', () => {
      try {
        // Windows then gives the UI the CPU first when both want it.
        if (c.pid) setPriority(c.pid, constants.priority.PRIORITY_BELOW_NORMAL);
      } catch (err) {
        log.warn({ err: String(err) }, 'could not lower the model process priority');
      }
    });
    c.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(new Error(m.error ?? 'model error'));
    });
    const gone = (why: string): void => {
      child = null;
      if (pending.size) log.warn({ why }, 'model process stopped with requests in flight');
      failAll('The on-device model process stopped. Try again.');
    };
    c.on('exit', (code) => gone(`exit ${code}`));
    c.on('error', (type) => gone(String(type)));
    return c;
  }

  /** One process at a time, even when several models warm up together. */
  const host = (): Promise<UtilityProcess> => {
    child ??= start().catch((err: unknown) => {
      child = null;
      throw err;
    });
    return child;
  };

  const call =
    (op: keyof InferenceOps) =>
    async (arg: unknown): Promise<never> => {
      const c = await host();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          reject(new Error('The on-device model took too long.'));
          // A wedged model blocks every later request: start afresh.
          log.warn({ op }, 'model request timed out; restarting the model process');
          c.kill();
        }, REQUEST_TIMEOUT_MS);
        const done =
          <T>(fn: (v: T) => void) =>
          (v: T): void => {
            clearTimeout(timer);
            fn(v);
          };
        pending.set(id, { resolve: done(resolve as (v: unknown) => void), reject: done(reject) });
        try {
          c.postMessage({ id, op, arg });
        } catch (err) {
          pending.delete(id);
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    };

  return {
    whisperWarm: call('whisperWarm'),
    transcribe: call('transcribe'),
    whisperRelease: call('whisperRelease'),
    layaWarm: call('layaWarm'),
    layaPredict: call('layaPredict'),
    kokoroWarm: call('kokoroWarm'),
    kokoroRun: call('kokoroRun'),
    piperRun: call('piperRun'),
    speakerEmbed: call('speakerEmbed'),
  };
}

/** In-process models, loaded only when first used (tests never import the native runtime otherwise). */
function localOps(): InferenceOps {
  let ops: Promise<InferenceOps> | null = null;
  const get = (): Promise<InferenceOps> =>
    (ops ??= import('./engines').then((m) => m.createLocalOps()));
  const call =
    <K extends keyof InferenceOps>(op: K) =>
    async (arg: Parameters<InferenceOps[K]>[0]): Promise<Awaited<ReturnType<InferenceOps[K]>>> =>
      ((await get())[op] as (a: typeof arg) => Promise<Awaited<ReturnType<InferenceOps[K]>>>)(arg);
  return {
    whisperWarm: call('whisperWarm'),
    transcribe: call('transcribe'),
    whisperRelease: call('whisperRelease'),
    layaWarm: call('layaWarm'),
    layaPredict: call('layaPredict'),
    kokoroWarm: call('kokoroWarm'),
    kokoroRun: call('kokoroRun'),
    piperRun: call('piperRun'),
    speakerEmbed: call('speakerEmbed'),
  };
}

let shared: InferenceOps | null = null;

/** The models, isolated when running as the Electron main process with the host built next to it. */
export function inference(): InferenceOps {
  shared ??= process.type === 'browser' && existsSync(HOST_FILE) ? remoteOps() : localOps();
  return shared;
}
