import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ConversationsRepo } from '../db/repos/conversations-repo';
import type { MemoryRepos } from '../db/repos/memory-repos';
import { keywords, toFtsQuery } from '../db/fts-query';
import { parseNote } from './frontmatter';
import type { Reranker } from './rerank';
import { fuse, type SemanticIndex } from './semantic';
import type { VaultService } from './vault-service';

/** About Sir.md must stay under ~1,500 tokens (Database.md §8.1); ~4 chars/token. */
const CORE_BUDGET_CHARS = 6000;
const PAST_REFERENCE =
  /\b(last (week|month|time|night)|yesterday|earlier|before|previously|we (decided|discussed|talked|said|agreed)|did (we|i)|remember when|what did)\b/i;

export interface MemoryHit {
  vaultPath: string;
  title: string;
  snippet: string;
}

/** API-Guide.md §6.2. */
export function createRetriever(deps: {
  vault: VaultService;
  repos: MemoryRepos;
  conversations: ConversationsRepo;
  /** Hybrid search when the on-device embedding model is installed (idea from isair/jarvis). */
  semantic?: SemanticIndex;
  /** Re-orders fused candidates with a cross-encoder when downloaded (idea from hindsight). */
  reranker?: Reranker;
}) {
  async function note(rel: string): Promise<string> {
    if (!deps.vault.exists(rel)) return '';
    const abs = deps.vault.resolve(rel);
    if (!existsSync(abs)) return '';
    return parseNote(await readFile(abs, 'utf8')).body.trim();
  }

  function query(text: string): string | null {
    // Keywords from the message plus any memory titles it mentions (people, projects).
    const lower = text.toLowerCase();
    const titles = deps.repos.memories
      .titles()
      .filter((t) => t.length > 2 && lower.includes(t.toLowerCase()));
    return toFtsQuery([...keywords(text), ...titles].join(' '));
  }

  return {
    async coreProfile(): Promise<string> {
      const [about, prefs] = await Promise.all([
        note('Memory/About Sir.md'),
        note('Memory/Preferences.md'),
      ]);
      const text = [about, prefs].filter(Boolean).join('\n\n');
      return text.length > CORE_BUDGET_CHARS
        ? `${text.slice(0, CORE_BUDGET_CHARS)}\n… (trimmed)`
        : text;
    },

    searchMemories(text: string, k = 6): MemoryHit[] {
      const q = query(text);
      if (!q) return [];
      return deps.repos.memories
        .search(q, k)
        .filter((m) => m.kind !== 'profile' && m.kind !== 'preference')
        .map((m) => ({
          vaultPath: m.vault_path,
          title: m.title,
          snippet: m.body.length <= 600 ? m.body : m.snippet,
        }));
    },

    searchConversations(text: string, k = 8, range: { from?: string; to?: string } = {}) {
      const q = toFtsQuery(text);
      return q ? deps.conversations.searchMessages(q, k, range) : [];
    },

    /** Keyword + meaning: notes that match the words or the sense of the request. */
    async findMemories(text: string, k = 6): Promise<MemoryHit[]> {
      const words = this.searchMemories(text, k * 2);
      const near = (await deps.semantic?.search('memory', text, k * 2)) ?? [];
      const byPath = new Map(words.map((h) => [h.vaultPath, h]));
      // With a re-ranker, fuse a wider pool and let it pick the best k.
      const pool = deps.reranker?.ready() ? k * 2 : k;
      const fused = fuse([words.map((h) => h.vaultPath), near.map((n) => n.ref)], pool).flatMap(
        (path) => {
          const hit = byPath.get(path);
          if (hit) return [hit];
          const m = deps.repos.memories.get(path);
          if (!m || m.kind === 'profile' || m.kind === 'preference') return [];
          return [
            {
              vaultPath: path,
              title: m.title,
              snippet: m.body.length <= 600 ? m.body : `${m.body.slice(0, 600)}…`,
            },
          ];
        },
      );
      return deps.reranker
        ? deps.reranker.rerank(text, fused, (h) => `${h.title}\n${h.snippet}`, k)
        : fused.slice(0, k);
    },

    async findConversations(text: string, k = 8, range: { from?: string; to?: string } = {}) {
      const words = this.searchConversations(text, k * 2, range);
      const near = (await deps.semantic?.search('message', text, k * 4)) ?? [];
      const extra = deps.conversations.messagesByIds(
        near.map((n) => n.ref).filter((id) => !words.some((w) => w.id === id)),
        range,
      );
      const byId = new Map([...words, ...extra].map((h) => [h.id, h]));
      return fuse(
        [words.map((h) => h.id), near.map((n) => n.ref).filter((id) => byId.has(id))],
        k,
      ).flatMap((id) => byId.get(id) ?? []);
    },

    /** The "Possibly relevant memories" part of the dynamic system block. */
    async buildContextBlock(userText: string): Promise<string> {
      const parts: string[] = [];
      for (const h of await this.findMemories(userText))
        parts.push(`- ${h.vaultPath} (${h.title}):\n${h.snippet.replace(/^/gm, '  ')}`);
      if (PAST_REFERENCE.test(userText)) {
        const convs = await this.findConversations(userText, 5);
        if (convs.length) {
          parts.push('Earlier conversations that may be relevant:');
          for (const c of convs)
            parts.push(
              `- ${c.createdAt.slice(0, 10)} "${c.title ?? 'untitled'}" (${c.role === 'user' ? 'sir' : 'assistant'}): ${c.snippet}`,
            );
        }
      }
      return parts.join('\n');
    },
  };
}

export type Retriever = ReturnType<typeof createRetriever>;
