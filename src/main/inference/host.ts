import { createLocalOps, type InferenceOps } from './engines';

/**
 * ADR-029: entry of the inference utility process (built to out/main/inference-host.js). It runs
 * one request at a time per model and answers by id; it never touches settings, files or the network
 * beyond the model files named in each request.
 */

interface Request {
  id: number;
  op: keyof InferenceOps;
  arg: unknown;
}

const ops = createLocalOps();
const port = process.parentPort;

port.on('message', (e: { data: Request }) => {
  const { id, op, arg } = e.data;
  const fn = ops[op] as ((a: unknown) => Promise<unknown>) | undefined;
  if (typeof fn !== 'function') {
    port.postMessage({ id, ok: false, error: `unknown inference op ${String(op)}` });
    return;
  }
  fn(arg).then(
    (value) => port.postMessage({ id, ok: true, value }),
    (err: unknown) =>
      port.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
});
