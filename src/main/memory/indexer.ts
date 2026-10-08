import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryKind, MemoryRepos, MemorySource } from '../db/repos/memory-repos';
import { sha256 } from '../lib/util';
import { parseNote } from './frontmatter';
import type { VaultService } from './vault-service';

const KINDS = new Set<MemoryKind>([
  'profile',
  'preference',
  'person',
  'project',
  'fact',
  'routine',
  'note',
]);

export function inferKind(rel: string, fm: Record<string, unknown>): MemoryKind {
  if (typeof fm['kind'] === 'string' && KINDS.has(fm['kind'] as MemoryKind))
    return fm['kind'] as MemoryKind;
  const lower = rel.toLowerCase();
  if (lower === 'memory/about sir.md') return 'profile';
  if (lower === 'memory/preferences.md') return 'preference';
  if (lower.startsWith('memory/people/')) return 'person';
  if (lower.startsWith('memory/projects/')) return 'project';
  if (lower.startsWith('memory/facts/')) return 'fact';
  return 'note';
}

export function titleOf(rel: string, fm: Record<string, unknown>, body: string): string {
  if (typeof fm['title'] === 'string' && fm['title'].trim()) return fm['title'].trim();
  const h = /^#\s+(.+)$/m.exec(body);
  return h?.[1]?.trim() ?? path.posix.basename(rel, '.md');
}

function tagsOf(fm: Record<string, unknown>): string[] {
  const t = fm['tags'];
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === 'string') return t.split(/[,\s]+/).filter(Boolean);
  return [];
}

/** Keeps the DB index (memories + FTS, vault_files, routines) in step with the vault. Rebuildable any time. */
export function createIndexer(deps: {
  repos: MemoryRepos;
  vault: VaultService;
  reloadRoutines(): Promise<void>;
}) {
  function indexContent(
    rel: string,
    content: string,
    mtimeMs: number,
    writer: 'jarvis' | 'external',
  ): void {
    const hash = sha256(content);
    deps.repos.vaultFiles.upsert(rel, hash, mtimeMs, writer);
    // Memory notes and Sir's Spaces pages are searchable; logs and internals are not.
    const searchable = rel.startsWith('Memory/') || rel.startsWith('Spaces/');
    if (!searchable || !rel.toLowerCase().endsWith('.md')) return;
    const { frontmatter, body } = parseNote(content);
    const declared =
      typeof frontmatter['source'] === 'string'
        ? (frontmatter['source'] as MemorySource)
        : undefined;
    const source: MemorySource = writer === 'external' ? 'user_edit' : (declared ?? 'memory_tool');
    deps.repos.memories.upsert({
      vaultPath: rel,
      title: titleOf(rel, frontmatter, body),
      kind: inferKind(rel, frontmatter),
      tags: tagsOf(frontmatter),
      body: body.trim(),
      hash,
      source: ['curator', 'memory_tool', 'user_edit', 'import'].includes(source)
        ? source
        : 'memory_tool',
      mtimeMs,
    });
  }

  async function indexFile(rel: string, writer: 'jarvis' | 'external'): Promise<boolean> {
    const abs = deps.vault.resolve(rel);
    const [content, s] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
    const known = deps.repos.vaultFiles.get(rel);
    if (known && known.content_hash === sha256(content)) return false; // our own write, or unchanged
    indexContent(rel, content, s.mtimeMs, writer);
    if (rel.startsWith('Routines/')) await deps.reloadRoutines();
    return true;
  }

  function remove(rel: string): void {
    deps.repos.memories.remove(rel);
    deps.repos.vaultFiles.remove(rel);
  }

  return {
    indexContent,
    indexFile,
    remove,
    async rebuild(): Promise<number> {
      deps.repos.truncateIndex();
      const files = await deps.vault.walk();
      for (const rel of files) {
        const abs = deps.vault.resolve(rel);
        const [content, s] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
        indexContent(rel, content, s.mtimeMs, 'external');
      }
      await deps.reloadRoutines();
      return files.length;
    },
  };
}

export type Indexer = ReturnType<typeof createIndexer>;
