import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LOCAL_STT_MODEL_IDS } from '@shared/speech-engines';
import { JarvisError } from '../../errors';
import { bunzip2 } from '../../lib/bzip2';
import { readTarFiles } from '../../lib/tar';
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

/** ADR-044: a model published only as a .tar.bz2 (sherpa-onnx releases); `files` live in `root`. */
interface ModelArchive {
  url: string;
  sha256: string;
  size: number;
  root: string;
}

interface ModelEntry {
  files: ModelFile[];
  archive?: ModelArchive;
}

/** Unpacked archives are capped well above any model we list (a hostile one can't fill the disk). */
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

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

type Job = (signal: AbortSignal, onBytes: (n: number) => void) => Promise<void>;

export function createModelStore(deps: {
  root: string;
  onProgress(p: Progress): void;
  /** Tests only. */
  fetch?: typeof fetch;
  manifest?: Record<ModelId, ModelEntry>;
}) {
  const doFetch = deps.fetch ?? fetch;
  const manifest: Record<ModelId, ModelEntry> = deps.manifest ?? MANIFEST;
  const filesOf = (id: ModelId): ModelFile[] => manifest[id].files;
  /** Bytes to download: the archive for archived models, else the files. */
  const downloadSize = (id: ModelId): number =>
    manifest[id].archive?.size ?? filesOf(id).reduce((b, f) => b + f.size, 0);
  const active = new Map<ModelId, AbortController>();
  const dir = (id: ModelId): string => join(deps.root, id);

  /** Size match is enough here; hashes are checked when the file is downloaded. */
  const fileReady = (id: ModelId, f: ModelFile): boolean => {
    const p = join(dir(id), f.path);
    return existsSync(p) && statSync(p).size === f.size;
  };
  const installed = (id: ModelId): boolean =>
    withDeps(id).every((m) => filesOf(m).every((f) => fileReady(m, f)));

  /** Downloads url to target, checking size and SHA-256 before the file takes its name. */
  async function fetchTo(
    url: string,
    expected: { path: string; size: number; sha256: string },
    target: string,
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    const f = expected;
    const part = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    const res = await doFetch(url, { signal, redirect: 'follow' });
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

  async function fetchFile(
    id: ModelId,
    f: ModelFile,
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    if (!f.url)
      throw new Error(
        `${id} can't be downloaded yet; install it by hand (docs/BIBLE.md, "Local decisions").`,
      );
    await fetchTo(f.url, f, join(dir(id), f.path), signal, onBytes);
  }

  /** ADR-044: the archive is checked, then only the listed files are unpacked and checked again. */
  async function fetchArchive(
    id: ModelId,
    a: ModelArchive,
    files: ModelFile[],
    signal: AbortSignal,
    onBytes: (n: number) => void,
  ): Promise<void> {
    const archive = join(dir(id), '.download.tar.bz2');
    const name = a.url.split('/').pop() ?? id;
    try {
      await fetchTo(
        a.url,
        { path: name, size: a.size, sha256: a.sha256 },
        archive,
        signal,
        onBytes,
      );
      const want = new Map(files.map((f) => [`${a.root}/${f.path}`, f]));
      const largest = Math.max(...files.map((f) => f.size));
      const found = await readTarFiles(
        bunzip2(await readFile(archive), MAX_UNPACKED_BYTES),
        new Set(want.keys()),
        largest,
      );
      for (const [path, f] of want) {
        if (signal.aborted) throw new Error('Download cancelled.');
        const data = found.get(path);
        if (!data) throw new Error(`${f.path} is missing from ${name}`);
        if (data.length !== f.size || sha256(data) !== f.sha256)
          throw new Error(
            `${f.path} failed its integrity check (expected sha256 ${f.sha256.slice(0, 12)}…)`,
          );
        const target = join(dir(id), f.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(`${target}.part`, data);
        await rename(`${target}.part`, target);
      }
    } finally {
      await rm(archive, { force: true });
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
            sizeBytes: withDeps(id).reduce((a, m) => a + downloadSize(m), 0),
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
      const todo = withDeps(id).flatMap((m): Array<{ bytes: number; run: Job }> => {
        const missing = filesOf(m).filter((f) => !fileReady(m, f));
        const a = manifest[m].archive;
        if (a && missing.length)
          return [{ bytes: a.size, run: (sig, on) => fetchArchive(m, a, missing, sig, on) }];
        return missing.map((f) => ({ bytes: f.size, run: (sig, on) => fetchFile(m, f, sig, on) }));
      });
      const totalBytes = todo.reduce((a, j) => a + j.bytes, 0);
      let receivedBytes = 0;
      let lastEmit = 0;
      try {
        for (const job of todo)
          await job.run(abort.signal, (n) => {
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
