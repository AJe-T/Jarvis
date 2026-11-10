import { existsSync, statSync } from 'node:fs';
import { cp, mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Tier } from '@shared/types';
import { ToolError } from '../../errors';
import type { PathGuard } from '../../security/path-guard';
import { defineTool, fail, ok, type Tool } from '../types';
import { DOCUMENT_EXT, documentText } from './documents';
import type { OsAdapter } from './os';

const MAX_READ = 1024 * 1024;
// ponytail: search_in_files reads files one by one, with no index. These caps keep it bounded
// (PDFs are parsed on the main thread); build an index if Sir searches big folders often.
const MAX_SEARCH_DOC = 5 * 1024 * 1024;
const MAX_SEARCH_DOCS = 15;
const MAX_SEARCH_FILES = 3000;
const SEARCH_BUDGET_MS = 15_000;
/** Credential stores search_in_files never opens, beyond SENSITIVE_FILE: it reads many files unasked. */
const SEARCH_SKIP =
  /(^|[\\/])(\.npmrc|\.netrc|\.pgpass|\.git-credentials|id_(ecdsa|dsa)|credentials[^\\/]*|secrets?[^\\/]*|.*\.(ppk|jks|keystore|ovpn|kdb))$/i;
/** A search for these is a hunt for secrets: Sir confirms it first (it could be a planted instruction). */
const SECRET_HUNT =
  /pass(word|phrase|wd)|secret|token|api[\s_-]?key|private[\s_-]?key|credential|\bpin\b|\botp\b|cvv/i;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'appdata',
  '$recycle.bin',
  '.cache',
  '.next',
  'dist',
  'out',
  'build',
  '.venv',
  '__pycache__',
]);
const EXECUTABLE =
  /\.(exe|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msp|scr|hta|cpl|jar|reg|pif|application|appref-ms|lnk|url)$/i;
export const SENSITIVE_FILE =
  /(^|[\\/])(\.env(\..*)?|id_rsa|id_ed25519|.*\.(pem|key|pfx|p12|kdbx))$/i;

const pathArg = z.string().min(3).max(1024);

export interface FileToolDeps {
  os: OsAdapter;
  guard: PathGuard;
  /** Allowed roots used when search_files is not given a folder. */
  roots(): string[];
  /** Paths that must never be deleted/moved even inside allowed roots (the vault root). */
  protectedPaths(): string[];
}

function list(paths: string[]): string {
  return paths.map((p) => `• ${p}`).join('\n');
}

function isProtected(deps: FileToolDeps, resolved: string): boolean {
  const lower = resolved.toLowerCase();
  return (
    deps.guard.isRoot(resolved) || deps.protectedPaths().some((p) => p.toLowerCase() === lower)
  );
}

/**
 * Every file under root, nearest folders first: 8 levels deep, 50,000 entries, no build or hidden
 * folders, and no folder `enter` turns away.
 */
async function* walkFiles(
  root: string,
  signal: AbortSignal,
  enter: (dir: string) => boolean = () => true,
): AsyncGenerator<string> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let scanned = 0;
  while (queue.length && scanned < 50_000 && !signal.aborted) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      scanned++;
      const full = path.join(dir, e.name);
      if (!e.isDirectory()) yield full;
      else if (
        depth < 8 &&
        !SKIP_DIRS.has(e.name.toLowerCase()) &&
        !e.name.startsWith('.') &&
        enter(full)
      )
        queue.push({ dir: full, depth: depth + 1 });
    }
  }
}

async function search(
  root: string,
  words: string[],
  ext: string | undefined,
  max: number,
  signal: AbortSignal,
) {
  const hits: Array<{ path: string; size: number; modified: string }> = [];
  if (max <= 0) return hits;
  for await (const full of walkFiles(root, signal)) {
    const name = path.basename(full).toLowerCase();
    if (ext && !name.endsWith(`.${ext}`)) continue;
    if (!words.every((w) => name.includes(w))) continue;
    const s = await stat(full).catch(() => null);
    if (s) hits.push({ path: full, size: s.size, modified: s.mtime.toISOString().slice(0, 10) });
    if (hits.length >= max) break;
  }
  return hits;
}

/** Text of one file for search_in_files, or null when it is skipped (too big, binary, unreadable). */
async function searchableText(file: string): Promise<string | null> {
  const s = await stat(file).catch(() => null);
  if (!s?.isFile()) return null;
  if (DOCUMENT_EXT.test(file)) {
    if (s.size > MAX_SEARCH_DOC) return null;
    return documentText(file).then(
      (d) => d.text,
      () => null, // damaged or password-protected
    );
  }
  if (s.size > MAX_READ) return null;
  const buf = await readFile(file).catch(() => null);
  return buf && !buf.includes(0) ? buf.toString('utf8') : null;
}

/** About 160 characters around the first matched word, on one line. */
function snippetAround(text: string, word: string): string {
  const at = Math.max(text.toLowerCase().indexOf(word), 0);
  const from = Math.max(at - 60, 0);
  const cut = text
    .slice(from, at + 100)
    .replace(/\s+/g, ' ')
    .trim();
  return `${from > 0 ? '…' : ''}${cut}${at + 100 < text.length ? '…' : ''}`;
}

interface ContentHit {
  path: string;
  snippet: string;
}

/**
 * Reads files under the roots until enough match, the time is up or the read caps are reached.
 * Every file is checked against the path guard first (a link may point outside the allowed
 * folders), and credential files are never opened here (read_text_file asks before reading one).
 */
async function searchContents(
  guard: PathGuard,
  roots: string[],
  words: string[],
  ext: string | undefined,
  max: number,
  signal: AbortSignal,
): Promise<{ hits: ContentHit[]; read: number; stoppedEarly: boolean }> {
  const hits: ContentHit[] = [];
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  let read = 0;
  let docs = 0;
  for (const root of roots) {
    // Denied folders are not entered at all: nothing in them may be read, and walking them is waste.
    for await (const file of walkFiles(root, signal, (dir) => guard.check(dir).ok)) {
      if (Date.now() > deadline || read >= MAX_SEARCH_FILES)
        return { hits, read, stoppedEarly: true };
      if (SENSITIVE_FILE.test(file) || SEARCH_SKIP.test(file) || !guard.check(file).ok) continue;
      if (ext && !file.toLowerCase().endsWith(`.${ext}`)) continue;
      const isDoc = DOCUMENT_EXT.test(file);
      if (isDoc && docs >= MAX_SEARCH_DOCS) continue;
      const text = await searchableText(file);
      if (text === null) continue;
      read++;
      if (isDoc) docs++;
      const lower = text.toLowerCase();
      if (!words.every((w) => lower.includes(w))) continue;
      hits.push({ path: file, snippet: snippetAround(text, words[0] ?? '') });
      if (hits.length >= max) return { hits, read, stoppedEarly: false };
    }
  }
  return { hits, read, stoppedEarly: signal.aborted };
}

export function createFileTools(deps: FileToolDeps): Tool[] {
  const { guard } = deps;
  return [
    defineTool({
      name: 'search_files',
      description:
        'Find files by name inside sir\'s allowed folders (Desktop, Documents, Downloads, …). Words must all appear in the file name. Optional extension filter (e.g. "pdf") and folder. Returns paths, sizes and dates.',
      input: z.object({
        query: z.string().min(1).max(100),
        ext: z
          .string()
          .regex(/^[a-z0-9]{1,8}$/i)
          .optional(),
        folder: pathArg.optional(),
        maxResults: z.number().int().min(1).max(100).default(20),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      timeoutMs: 20_000,
      summarize: ({ query, ext }) => `Search files for "${query}"${ext ? ` (.${ext})` : ''}`,
      guards: ({ folder }) => ({ paths: folder ? [folder] : [] }),
      async run({ query, ext, folder, maxResults }, ctx) {
        const roots = folder
          ? [guard.resolve(folder)]
          : deps.roots().filter((r) => guard.check(r).ok);
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const hits = [];
        for (const r of roots) {
          hits.push(
            ...(await search(r, words, ext?.toLowerCase(), maxResults - hits.length, ctx.signal)),
          );
          if (hits.length >= maxResults) break;
        }
        if (hits.length === 0)
          return ok(`No files named like "${query}" in ${folder ?? 'the allowed folders'}.`);
        return ok(
          hits.map((h) => `${h.path}  (${Math.ceil(h.size / 1024)} KB, ${h.modified})`).join('\n'),
        );
      },
    }),
    defineTool({
      name: 'search_in_files',
      description:
        "Find files by what they SAY, inside sir's allowed folders: every word must appear in the file's text. Reads text files (≤ 1 MB) and PDF, Word, Excel and PowerPoint (≤ 5 MB). Use search_files when sir knows the name. Optional extension and folder; a folder is much faster. Returns paths with the matching line; stops after about 15 seconds and says so. Credential files are never opened; searching for passwords, keys or tokens needs sir's confirmation.",
      input: z.object({
        text: z.string().trim().min(2).max(100),
        ext: z
          .string()
          .regex(/^[a-z0-9]{1,8}$/i)
          .optional(),
        folder: pathArg.optional(),
        maxResults: z.number().int().min(1).max(20).default(10),
      }),
      tier: ({ text }): Tier => (SECRET_HUNT.test(text) ? 'CONFIRM' : 'SAFE'),
      untrustedOutput: true,
      timeoutMs: 30_000,
      summarize: ({ text, ext }) => `Search inside files for "${text}"${ext ? ` (.${ext})` : ''}`,
      guards: ({ folder }) => ({ paths: folder ? [folder] : [] }),
      async run({ text, ext, folder, maxResults }, ctx) {
        const roots = folder
          ? [guard.resolve(folder)]
          : deps.roots().filter((r) => guard.check(r).ok);
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        const { hits, read, stoppedEarly } = await searchContents(
          guard,
          roots,
          words,
          ext?.toLowerCase(),
          maxResults,
          ctx.signal,
        );
        const where = folder ?? 'the allowed folders';
        const note = stoppedEarly
          ? ` The search stopped early after reading ${read} files; name a folder or an extension to search the rest.`
          : '';
        if (hits.length === 0) return ok(`No file in ${where} says "${text}".${note}`);
        return ok(
          `${hits.map((h) => `${h.path}\n    ${h.snippet}`).join('\n')}${note && `\n${note.trim()}`}`,
        );
      },
    }),
    defineTool({
      name: 'read_text_file',
      description:
        'Read a text file (≤ 1 MB) in the allowed folders. Returns its contents. Binary files are refused. Credential files (.env, keys) need confirmation.',
      input: z.object({ path: pathArg }),
      tier: ({ path: p }): Tier => (SENSITIVE_FILE.test(p) ? 'CONFIRM' : 'SAFE'),
      untrustedOutput: true,
      summarize: ({ path: p }) => `Read ${path.basename(p)}`,
      guards: ({ path: p }) => ({ paths: [p] }),
      async run({ path: p }) {
        const file = guard.resolve(p);
        const handle = await open(file, 'r').catch(() => {
          throw new ToolError(`Can't open ${file}: it doesn't exist or isn't readable.`);
        });
        try {
          const s = await handle.stat();
          if (s.isDirectory()) return fail(`${file} is a folder. Use search_files to list it.`);
          if (s.size > MAX_READ)
            return fail(`${file} is ${(s.size / 1024 / 1024).toFixed(1)} MB; the limit is 1 MB.`);
          const buf = await handle.readFile();
          if (buf.includes(0)) return fail(`${file} looks like a binary file, not text.`);
          return {
            content: [{ type: 'text', text: buf.toString('utf8') }],
            untrustedSource: `file:${file}`,
          };
        } finally {
          await handle.close();
        }
      },
    }),
    defineTool({
      name: 'write_text_file',
      description:
        'Create a text file, or overwrite one when overwrite is true, in the allowed folders. Requires confirmation. Max 1 MB.',
      input: z.object({
        path: pathArg,
        content: z.string().max(MAX_READ),
        overwrite: z.boolean().default(false),
      }),
      tier: 'CONFIRM',
      destructive: ({ path: p, overwrite }) => overwrite && existsSync(p),
      summarize: ({ path: p, overwrite }) =>
        `${overwrite && existsSync(p) ? 'Overwrite' : 'Create'} ${path.basename(p)}`,
      confirm: ({ path: p, content, overwrite }) => ({
        title: `${overwrite && existsSync(p) ? 'Overwrite' : 'Create'} ${path.basename(p)}?`,
        actionLabel: overwrite && existsSync(p) ? 'Overwrite file' : 'Create file',
        details: `${p}\n\n${content.slice(0, 2000)}${content.length > 2000 ? '\n…' : ''}`,
        detailsKind: 'code',
      }),
      guards: ({ path: p }) => ({ paths: [p] }),
      async run({ path: p, content, overwrite }) {
        const file = guard.resolve(p);
        if (existsSync(file) && !overwrite)
          return fail(`${file} already exists. Set overwrite to true to replace it.`);
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.jarvis-tmp`;
        await writeFile(tmp, content, 'utf8');
        await rename(tmp, file);
        return ok(`Saved ${file}.`);
      },
    }),
    defineTool({
      name: 'create_folder',
      description:
        'Create a folder (and any missing parents) in the allowed folders. Requires confirmation.',
      input: z.object({ path: pathArg }),
      tier: 'CONFIRM',
      summarize: ({ path: p }) => `Create folder ${path.basename(p)}`,
      confirm: ({ path: p }) => ({
        title: `Create folder "${path.basename(p)}"?`,
        actionLabel: 'Create folder',
        details: p,
        detailsKind: 'paths',
      }),
      guards: ({ path: p }) => ({ paths: [p] }),
      async run({ path: p }) {
        const dir = guard.resolve(p);
        if (existsSync(dir)) return ok(`${dir} already exists.`);
        await mkdir(dir, { recursive: true });
        return ok(`Created ${dir}.`);
      },
    }),
    defineTool({
      name: 'move_path',
      description:
        'Move a file or folder to another location inside the allowed folders. Will not overwrite. Requires confirmation.',
      input: z.object({ from: pathArg, to: pathArg }),
      tier: 'CONFIRM',
      summarize: ({ from, to }) =>
        `Move ${path.basename(from)} to ${path.dirname(to) === to ? to : to}`,
      confirm: ({ from, to }) => ({
        title: `Move ${path.basename(from)}?`,
        actionLabel: 'Move',
        details: `${from}\n→ ${to}`,
        detailsKind: 'paths',
      }),
      guards: ({ from, to }) => ({ paths: [from, to] }),
      async run({ from, to }) {
        const src = guard.resolve(from);
        let dest = guard.resolve(to);
        if (!existsSync(src)) return fail(`${src} doesn't exist.`);
        if (isProtected(deps, src)) return fail('That folder is protected and cannot be moved.');
        if (existsSync(dest) && statSync(dest).isDirectory())
          dest = guard.resolve(path.join(dest, path.basename(src)));
        if (existsSync(dest)) return fail(`${dest} already exists; choose another name.`);
        await mkdir(path.dirname(dest), { recursive: true });
        await rename(src, dest).catch(async (err: NodeJS.ErrnoException) => {
          if (err.code !== 'EXDEV') throw err;
          await cp(src, dest, { recursive: true, errorOnExist: true });
          await deps.os.trashItem(src); // cross-drive move: copy, then Recycle Bin (never permanent delete)
        });
        return ok(`Moved to ${dest}.`);
      },
    }),
    defineTool({
      name: 'rename_path',
      description:
        'Rename a file or folder in place (new name only, no folders). Requires confirmation.',
      input: z.object({
        path: pathArg,
        newName: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^\\/:*?"<>|]+$/, 'A name, not a path'),
      }),
      tier: 'CONFIRM',
      summarize: ({ path: p, newName }) => `Rename ${path.basename(p)} to ${newName}`,
      confirm: ({ path: p, newName }) => ({
        title: `Rename ${path.basename(p)}?`,
        actionLabel: 'Rename',
        details: `${p}\n→ ${newName}`,
        detailsKind: 'paths',
      }),
      guards: ({ path: p, newName }) => ({ paths: [p, path.join(path.dirname(p), newName)] }),
      async run({ path: p, newName }) {
        const src = guard.resolve(p);
        const dest = guard.resolve(path.join(path.dirname(src), newName));
        if (!existsSync(src)) return fail(`${src} doesn't exist.`);
        if (isProtected(deps, src)) return fail('That folder is protected and cannot be renamed.');
        if (existsSync(dest) && dest.toLowerCase() !== src.toLowerCase())
          return fail(`${newName} already exists there.`);
        await rename(src, dest);
        return ok(`Renamed to ${dest}.`);
      },
    }),
    defineTool({
      name: 'copy_path',
      description:
        'Copy a file or folder to another location inside the allowed folders. Will not overwrite. Requires confirmation.',
      input: z.object({ from: pathArg, to: pathArg }),
      tier: 'CONFIRM',
      timeoutMs: 120_000,
      summarize: ({ from }) => `Copy ${path.basename(from)}`,
      confirm: ({ from, to }) => ({
        title: `Copy ${path.basename(from)}?`,
        actionLabel: 'Copy',
        details: `${from}\n→ ${to}`,
        detailsKind: 'paths',
      }),
      guards: ({ from, to }) => ({ paths: [from, to] }),
      async run({ from, to }) {
        const src = guard.resolve(from);
        let dest = guard.resolve(to);
        if (!existsSync(src)) return fail(`${src} doesn't exist.`);
        if (existsSync(dest) && statSync(dest).isDirectory())
          dest = guard.resolve(path.join(dest, path.basename(src)));
        if (existsSync(dest)) return fail(`${dest} already exists.`);
        await cp(src, dest, { recursive: true, errorOnExist: true });
        return ok(`Copied to ${dest}.`);
      },
    }),
    defineTool({
      name: 'delete_to_recycle_bin',
      description:
        'Move files or folders to the Recycle Bin (recoverable; never a permanent delete). Requires confirmation that lists every item.',
      input: z.object({ paths: z.array(pathArg).min(1).max(200) }),
      tier: 'CONFIRM',
      destructive: true,
      summarize: ({ paths }) =>
        paths.length === 1
          ? `Move ${path.basename(paths[0] ?? '')} to the Recycle Bin`
          : `Move ${paths.length} items to the Recycle Bin`,
      confirm: ({ paths }) => ({
        title:
          paths.length === 1
            ? `Move ${path.basename(paths[0] ?? '')} to the Recycle Bin?`
            : `Move ${paths.length} items to the Recycle Bin?`,
        actionLabel: 'Move to Recycle Bin',
        details: list(paths),
        detailsKind: 'paths',
      }),
      guards: ({ paths }) => ({ paths }),
      async run({ paths }) {
        const resolved = paths.map((p) => guard.resolve(p));
        const missing = resolved.filter((p) => !existsSync(p));
        if (resolved.some((p) => isProtected(deps, p)))
          return fail(
            'One of those is a protected folder (an allowed root or the vault) and cannot be deleted.',
          );
        let done = 0;
        for (const p of resolved) {
          if (!existsSync(p)) continue;
          await deps.os.trashItem(p);
          done++;
        }
        return ok(
          `Moved ${done} item(s) to the Recycle Bin.${missing.length ? ` Not found: ${missing.join(', ')}` : ''}`,
        );
      },
    }),
    defineTool({
      name: 'open_path',
      description:
        'Open a document or folder with its default app (e.g. a PDF, a photo, a folder in Explorer). Programs and scripts cannot be opened this way; use open_app.',
      input: z.object({ path: pathArg }),
      tier: ({ path: p }): Tier => (EXECUTABLE.test(p.trim()) ? 'BLOCKED' : 'SAFE'),
      summarize: ({ path: p }) => `Open ${path.basename(p)}`,
      guards: ({ path: p }) => ({ paths: [p] }),
      async run({ path: p }) {
        const target = guard.resolve(p);
        if (!existsSync(target)) return fail(`${target} doesn't exist.`);
        await deps.os.openPath(target);
        return ok(`Opened ${target}.`);
      },
    }),
  ];
}
