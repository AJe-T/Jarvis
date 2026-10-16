import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LOCAL_STT_MODEL_IDS } from '@shared/speech-engines';
import { JarvisError } from '../../errors';
import MANIFEST from './models.json';

/** ADR-011: local voice models, pinned to exact revisions and SHA-256 hashes (scripts/make-model-manifest.mjs). */
export type ModelId = keyof typeof MANIFEST;
export const MODEL_IDS = Object.keys(MANIFEST) as ModelId[];

interface ModelFile {
  path: string;
  /** null: not hosted anywhere yet, so the model is installed by hand (Laya, ADR-027). */
  url: string | null;
  sha256: string;
  size: number;
}

/** Speech-to-text models need the voice-activity model to know when Sir stopped talking. */
const REQUIRES: Partial<Record<ModelId, ModelId[]>> = Object.fromEntries(
  LOCAL_STT_MODEL_IDS.map((id) => [id, ['silero-vad']]),
);

export interface ModelStatus {
  installed: boolean;
  sizeBytes: number;
  downloading: boolean;
}

export interface Progress {
  id: ModelId;
  receivedBytes: number;
  totalBytes: number;
  done?: boolean;
  error?: string;
}

const withDeps = (id: ModelId): ModelId[] => [id, ...(REQUIRES[id] ?? [])];

export function createModelStore(deps: {
  root: string;
  onProgress(p: Progress): void;
  /** Tests only. */
  fetch?: typeof fetch;
  manifest?: Record<ModelId, { files: ModelFile[] }>;
}) {
  const doFetch = deps.fetch ?? fetch;
  const manifest = deps.manifest ?? MANIFEST;
  const filesOf = (id: ModelId): ModelFile[] => manifest[id].files;
  const active = new Map<ModelId, AbortController>();
  const dir = (id: ModelId): string => join(deps.root, id);

  /** Size match is enough here; hashes are checked when the file is downloaded. */
  const fileReady = (id: ModelId, f: ModelFile): boolean => {
    const p = join(dir(id), f.path);
    return existsSync(p) && statSync(p).size === f.size;
  };
  const installed = (id: ModelId): boolean =>
    withDeps(id).every((m) => filesOf(m).every((f) => fileReady(m, f)));

  async function fetchFile(
    id: ModelId,
    f: ModelFile,
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    const target = join(dir(id), f.path);
    const part = `${target}.part`;
    if (!f.url)
      throw new Error(
        `${id} can't be downloaded yet; install it by hand (docs/BIBLE.md, "Local decisions").`,
      );
    await mkdir(dirname(target), { recursive: true });
    const res = await doFetch(f.url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${f.path}`);
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let size = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > f.size) throw new Error(`${f.path} is larger than expected`);
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
        onBytes(chunk.length);
      }
      await new Promise<void>((resolve, reject) =>
        out.end((err?: Error | null) => (err ? reject(err) : resolve())),
      );
      const digest = hash.digest('hex');
      if (size !== f.size || digest !== f.sha256)
        throw new Error(
          `${f.path} failed its integrity check (expected sha256 ${f.sha256.slice(0, 12)}…)`,
        );
      await rename(part, target);
    } catch (err) {
      out.destroy();
      await rm(part, { force: true });
      throw err;
    }
  }

  return {
    dir,
    installed,
    status(): Record<ModelId, ModelStatus> {
      return Object.fromEntries(
        MODEL_IDS.map((id) => [
          id,
          {
            installed: installed(id),
            sizeBytes: withDeps(id).reduce(
              (a, m) => a + filesOf(m).reduce((b, f) => b + f.size, 0),
              0,
            ),
            downloading: active.has(id),
          },
        ]),
      ) as Record<ModelId, ModelStatus>;
    },

    /** Downloads the model and what it needs; resolves when done. Progress goes to onProgress. */
    async download(id: ModelId): Promise<void> {
      if (!MODEL_IDS.includes(id))
        throw new JarvisError('INVALID', `unknown model ${id}`, 'Unknown model.');
      if (active.has(id)) return;
      const abort = new AbortController();
      active.set(id, abort);
      const todo = withDeps(id).flatMap((m) =>
        filesOf(m)
          .filter((f) => !fileReady(m, f))
          .map((f) => [m, f] as const),
      );
      const totalBytes = todo.reduce((a, [, f]) => a + f.size, 0);
      let receivedBytes = 0;
      let lastEmit = 0;
      try {
        for (const [m, f] of todo)
          await fetchFile(m, f, abort.signal, (n) => {
            receivedBytes += n;
            const now = Date.now();
            if (now - lastEmit > 250) {
              lastEmit = now;
              deps.onProgress({ id, receivedBytes, totalBytes });
            }
          });
        deps.onProgress({ id, receivedBytes: totalBytes, totalBytes, done: true });
      } catch (err) {
        const message = abort.signal.aborted
          ? 'Download cancelled.'
          : err instanceof Error
            ? err.message
            : String(err);
        deps.onProgress({ id, receivedBytes, totalBytes, done: true, error: message });
        throw new JarvisError('TOOL_FAILED', message, `Model download failed: ${message}`);
      } finally {
        active.delete(id);
      }
    },

    cancel(id: ModelId): void {
      active.get(id)?.abort();
    },

    async remove(id: ModelId): Promise<void> {
      active.get(id)?.abort();
      await rm(dir(id), { recursive: true, force: true });
    },
  };
}

export type ModelStore = ReturnType<typeof createModelStore>;
