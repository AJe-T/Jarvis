import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryRepos } from '../db/repos/memory-repos';
import { PolicyError } from '../errors';
import { sha256 } from '../lib/util';
import { redact } from '../security/redact';
import { parseNote } from './frontmatter';
import { SKELETON } from './skeleton';

export interface VaultEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
}

export interface WriteResult {
  rel: string;
  merged: boolean;
  hash: string;
}

const SKIP = new Set(['.obsidian', '.trash', '_jarvis', '.git']);

/** Vault-relative paths always use forward slashes ('Memory/People/Pradyumna.md'). */
export function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Database.md §8: Markdown vault I/O. Every write is redacted, atomic (tmp → rename), merges instead
 * of overwriting when Sir edited the file since Jarvis last saw it, and is indexed immediately.
 */
export function createVaultService(deps: {
  root(): string;
  repos: MemoryRepos;
  onWritten?(rel: string, content: string, mtimeMs: number): void;
  onRemoved?(rel: string): void;
}) {
  function root(): string {
    return path.resolve(deps.root());
  }

  function resolve(relInput: string): string {
    const rel = normalizeRel(relInput);
    // eslint-disable-next-line no-control-regex -- control characters are illegal in Windows file names
    if (
      rel.split('/').some((s) => s === '..' || /[. ]$/.test(s) || /[<>:"|?*\u0000-\u001f]/.test(s))
    )
      throw new PolicyError(`Invalid vault path: ${relInput}`);
    const base = root();
    const abs = path.resolve(base, rel);
    const realBase = existsSync(base) ? realpathSync.native(base) : base;
    const real = existsSync(abs) ? realpathSync.native(abs) : abs;
    const inside = (p: string, b: string): boolean =>
      p.toLowerCase() === b.toLowerCase() ||
      p.toLowerCase().startsWith(`${b.toLowerCase()}${path.sep}`);
    if (!inside(abs, base) || (existsSync(abs) && !inside(real, realBase)))
      throw new PolicyError(`Path escapes the vault: ${relInput}`);
    return abs;
  }

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lock = path.join(root(), '_jarvis', '.jarvis-lock');
    await mkdir(path.dirname(lock), { recursive: true });
    await writeFile(lock, String(process.pid)).catch(() => undefined);
    try {
      return await fn();
    } finally {
      await rm(lock, { force: true }).catch(() => undefined);
    }
  }

  async function atomicWrite(abs: string, content: string): Promise<number> {
    await mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, abs);
    return (await stat(abs)).mtimeMs;
  }

  async function read(
    rel: string,
  ): Promise<{ frontmatter: Record<string, unknown>; body: string; raw: string; hash: string }> {
    const raw = await readFile(resolve(rel), 'utf8');
    const { frontmatter, body } = parseNote(raw);
    return { frontmatter, body, raw, hash: sha256(raw) };
  }

  async function write(
    relInput: string,
    markdown: string,
    opts: { expectedHash?: string | undefined } = {},
  ): Promise<WriteResult> {
    const rel = normalizeRel(relInput);
    const abs = resolve(rel);
    const clean = redact(markdown);
    return withLock(async () => {
      let content = clean;
      let merged = false;
      if (existsSync(abs)) {
        const current = await readFile(abs, 'utf8');
        const currentHash = sha256(current);
        const known = deps.repos.vaultFiles.get(rel);
        const jarvisOwnsCurrent =
          known?.last_writer === 'jarvis' && known.content_hash === currentHash;
        const callerSawCurrent = opts.expectedHash === currentHash;
        if (!jarvisOwnsCurrent && !callerSawCurrent && current.trim() && current !== clean) {
          // Sir edited this file since Jarvis last wrote it: keep his text, append ours (§8.5 step 3).
          content = `${current.trimEnd()}\n\n## Updates from Jarvis\n\n${parseNote(clean).body.trim()}\n`;
          merged = true;
        }
      }
      const mtime = await atomicWrite(abs, content);
      const hash = sha256(content);
      deps.repos.vaultFiles.upsert(rel, hash, mtime, 'jarvis');
      deps.onWritten?.(rel, content, mtime);
      return { rel, merged, hash };
    });
  }

  async function trash(relInput: string): Promise<string> {
    const rel = normalizeRel(relInput);
    const abs = resolve(rel);
    if (!rel || abs.toLowerCase() === root().toLowerCase())
      throw new PolicyError('The vault root cannot be deleted.');
    if (!existsSync(abs)) throw new PolicyError(`${rel} does not exist.`);
    // Obsidian convention: deleted notes go to <vault>/.trash, recoverable from Obsidian.
    const trashDir = path.join(root(), '.trash');
    await mkdir(trashDir, { recursive: true });
    let target = path.join(trashDir, path.basename(abs));
    if (existsSync(target))
      target = path.join(
        trashDir,
        `${path.basename(abs, '.md')} ${Date.now()}${path.extname(abs)}`,
      );
    await rename(abs, target);
    deps.repos.vaultFiles.remove(rel);
    deps.onRemoved?.(rel);
    return path.relative(root(), target).replace(/\\/g, '/');
  }

  async function list(dirRel = ''): Promise<VaultEntry[]> {
    const abs = resolve(dirRel);
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
    const out: VaultEntry[] = [];
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.endsWith('.tmp')) continue;
      const full = path.join(abs, e.name);
      const s = await stat(full).catch(() => null);
      out.push({
        path: normalizeRel(path.posix.join(normalizeRel(dirRel), e.name)),
        name: e.name,
        isDir: e.isDirectory(),
        size: s?.size ?? 0,
      });
    }
    return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  }

  /** Every Markdown file in the vault (relative paths), skipping Obsidian/Jarvis internals. */
  async function walk(dirRel = ''): Promise<string[]> {
    const out: string[] = [];
    for (const e of await list(dirRel)) {
      if (e.isDir) out.push(...(await walk(e.path)));
      else if (e.name.toLowerCase().endsWith('.md')) out.push(e.path);
    }
    return out;
  }

  async function ensureSkeleton(): Promise<{ created: string[] }> {
    const created: string[] = [];
    for (const dir of [
      'Memory/People',
      'Memory/Projects',
      'Memory/Facts',
      'Memory/Notes',
      'Conversations',
      'Routines',
      'Tasks',
      'Inbox',
      '_jarvis/templates',
    ]) {
      await mkdir(resolve(dir), { recursive: true });
    }
    for (const [rel, content] of Object.entries(SKELETON)) {
      if (existsSync(resolve(rel))) continue;
      await write(rel, content);
      created.push(rel);
    }
    return { created };
  }

  return {
    root,
    resolve,
    read,
    write,
    trash,
    list,
    walk,
    ensureSkeleton,
    exists: (rel: string): boolean => existsSync(resolve(rel)),
    /** Appends text to a file Jarvis manages (conversation logs, reminders mirror). */
    async append(relInput: string, text: string, header: string): Promise<void> {
      const rel = normalizeRel(relInput);
      const abs = resolve(rel);
      await withLock(async () => {
        const current = existsSync(abs) ? await readFile(abs, 'utf8') : header;
        const content = `${current.trimEnd()}\n\n${redact(text).trim()}\n`;
        const mtime = await atomicWrite(abs, content);
        deps.repos.vaultFiles.upsert(rel, sha256(content), mtime, 'jarvis');
      });
    },
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
