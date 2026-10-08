import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseNote } from './frontmatter';
import { titleOf } from './indexer';
import type { VaultService } from './vault-service';

export interface GraphNode {
  id: string;
  title: string;
  /** Colour group: the note's folder ("Memory/People", "Spaces/Finance") or "folder" for hubs. */
  group: string;
  size: number;
  updatedAt: string;
}
export interface GraphLink {
  source: string;
  target: string;
  kind: 'link' | 'folder';
}

const MAX_NOTES = 1500;
/** [[Target]], [[Target|alias]], [[Target#heading]] and [text](Some%20Note.md). */
const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MD_LINK = /\]\(([^)\s]+\.md)\)/gi;

/** Every link target written in a note, as written (no resolution). */
export function extractLinks(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(WIKI)) if (m[1]) out.add(m[1].trim());
  for (const m of markdown.matchAll(MD_LINK))
    if (m[1]) out.add(decodeURIComponent(m[1]).replace(/\.md$/i, ''));
  return [...out];
}

/**
 * The Brain view's data: notes are dots, [[links]] connect them like Obsidian's graph, and every note
 * also hangs off a hub dot for its folder so the vault reads as one connected network.
 */
export async function buildGraph(
  vault: VaultService,
): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> {
  const files = await vault.walk();
  const withTime = await Promise.all(
    files.map(async (rel) => ({ rel, st: await stat(vault.resolve(rel)).catch(() => null) })),
  );
  const notes = withTime
    .filter((f) => f.st)
    .sort((a, b) => (b.st?.mtimeMs ?? 0) - (a.st?.mtimeMs ?? 0))
    .slice(0, MAX_NOTES);

  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const byName = new Map<string, string>();
  const bodies = new Map<string, string>();

  for (const { rel, st } of notes) {
    const raw = await readFile(vault.resolve(rel), 'utf8').catch(() => '');
    const { frontmatter, body } = parseNote(raw);
    const folder = path.posix.dirname(rel);
    nodes.set(rel, {
      id: rel,
      title: titleOf(rel, frontmatter, body),
      group: folder === '.' ? 'Vault' : folder.split('/').slice(0, 2).join('/'),
      size: st?.size ?? 0,
      updatedAt: (st?.mtime ?? new Date()).toISOString(),
    });
    byName.set(path.posix.basename(rel, '.md').toLowerCase(), rel);
    byName.set(rel.replace(/\.md$/i, '').toLowerCase(), rel);
    bodies.set(rel, raw);
  }

  // Folder hubs: note → its folder → parent folder … → vault root.
  const hub = (dir: string): string => `folder:${dir}`;
  const addHub = (dir: string): void => {
    if (nodes.has(hub(dir))) return;
    nodes.set(hub(dir), {
      id: hub(dir),
      title: dir === '.' ? 'Vault' : path.posix.basename(dir),
      group: 'folder',
      size: 0,
      updatedAt: new Date(0).toISOString(),
    });
    if (dir !== '.') {
      const parent = path.posix.dirname(dir);
      addHub(parent);
      links.push({ source: hub(dir), target: hub(parent), kind: 'folder' });
    }
  };
  for (const rel of bodies.keys()) {
    const dir = path.posix.dirname(rel);
    addHub(dir);
    links.push({ source: rel, target: hub(dir), kind: 'folder' });
  }

  const seen = new Set<string>();
  for (const [rel, raw] of bodies) {
    for (const target of extractLinks(raw)) {
      const to = byName.get(target.toLowerCase());
      if (!to || to === rel) continue;
      const key = [rel, to].sort().join('→');
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: rel, target: to, kind: 'link' });
    }
  }
  return { nodes: [...nodes.values()], links };
}
