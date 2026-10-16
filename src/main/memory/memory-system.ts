import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createMemoryRepos } from '../db/repos/memory-repos';
import { errorMessage } from '../errors';
import { logger } from '../logging/logger';
import { pickModel } from '../agent/model-router';
import { historyWindow } from '../agent/context-builder';
import { keywords } from '../db/fts-query';
import type { Services } from '../services';
import { defineTool, ok, type Tool } from '../tools/types';
import { createConversationLogger } from './conversation-logger';
import { createCurator } from './curator';
import { createIndexer } from './indexer';
import { createMemoryTool } from './memory-tool';
import { createRetriever } from './retriever';
import { OBSERVATIONS_PATH, REFLECT_EVERY_MS, reflect, reflectDue } from './reflect';
import { createReranker } from './rerank';
import { createSemanticIndex } from './semantic';
import { createBrowserRoutineTool, createRoutineTools, loadRoutines } from './routines';
import { createVaultService } from './vault-service';
import { createVaultWatcher } from './vault-watcher';
import { findDuplicates, tidyReason } from './tidy';

/** Memory tidy-up: first run a few minutes after start, then daily. */
const TIDY_FIRST_MS = 5 * 60_000;
const TIDY_EVERY_MS = 24 * 3_600_000;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-10-07.');

/** Sir's local days (inclusive) → UTC instants, end exclusive, as stored in messages.created_at. */
export function localDayRange(from?: string, to?: string): { from?: string; to?: string } {
  const start = (d: string): Date => new Date(`${d}T00:00:00`);
  const end = to ? start(to) : null;
  end?.setDate(end.getDate() + 1);
  return {
    ...(from ? { from: start(from).toISOString() } : {}),
    ...(end ? { to: end.toISOString() } : {}),
  };
}

const RECALL_MAX_CHARS = 1500;

/**
 * recall_earlier (idea from ranxianglei/billion-context's decompress; code is ours): long chats keep
 * only the newest messages verbatim and fold the rest into a summary. This returns the exact words
 * that were folded away, so a number or a name lost in the summary can be looked up again.
 */
export function recallEarlierTool(conversations: Services['conversations']): Tool {
  return defineTool({
    name: 'recall_earlier',
    description:
      'Exact earlier messages of THIS conversation that are no longer in view (folded into the summary to save space). Use when the summary lacks a detail: a number, a name, the exact wording. Optional query keeps only matching messages.',
    input: z.object({
      query: z.string().min(1).max(200).optional(),
      limit: z.number().int().min(1).max(30).default(10),
    }),
    tier: 'SAFE',
    summarize: ({ query }) => `Recall earlier messages${query ? ` about "${query}"` : ''}`,
    async run({ query, limit }, ctx) {
      const rows = conversations.messages(ctx.conversationId);
      const conv = conversations.get(ctx.conversationId);
      const inView = new Set(
        historyWindow(rows, conv?.summary_upto_seq ?? 0).included.map((r) => r.id),
      );
      const folded = rows.filter((r) => !inView.has(r.id) && r.text_plain.trim());
      if (!folded.length)
        return ok('Nothing in this conversation is folded away; all of it is already in view.');
      const words = query ? keywords(query) : [];
      const score = (text: string): number => {
        const t = text.toLowerCase();
        return words.filter((w) => t.includes(w)).length;
      };
      const picked = words.length
        ? folded
            .map((r) => ({ r, s: score(r.text_plain) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s || a.r.seq - b.r.seq)
            .slice(0, limit)
            .map((x) => x.r)
            .sort((a, b) => a.seq - b.seq)
        : folded.slice(-limit);
      if (!picked.length) return ok(`No earlier message mentions "${query ?? ''}".`);
      return ok(
        picked
          .map((r) => {
            const text =
              r.text_plain.length > RECALL_MAX_CHARS
                ? `${r.text_plain.slice(0, RECALL_MAX_CHARS)}…`
                : r.text_plain;
            return `${r.created_at.slice(0, 16).replace('T', ' ')} · ${r.role === 'user' ? 'sir' : 'assistant'}: ${text}`;
          })
          .join('\n\n'),
      );
    },
  });
}

function searchTools(m: {
  retriever: ReturnType<typeof createRetriever>;
  conversations: Services['conversations'];
}): Tool[] {
  return [
    defineTool({
      name: 'search_memory',
      description:
        "Full-text search of sir's memory notes (people, projects, facts, preferences). Use when the injected memories don't cover the question.",
      input: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      tier: 'SAFE',
      summarize: ({ query }) => `Search memory for "${query}"`,
      async run({ query, limit }) {
        const hits = await m.retriever.findMemories(query, limit);
        return ok(
          hits.length
            ? hits.map((h) => `${h.vaultPath} — ${h.title}\n${h.snippet}`).join('\n\n')
            : 'No matching memories.',
        );
      },
    }),
    recallEarlierTool(m.conversations),
    defineTool({
      name: 'search_conversations',
      description: `Search past conversations with sir. Give a query for "what did we decide about X"; give from/to dates (YYYY-MM-DD, Sir's local days, inclusive) for "what did we talk about yesterday / last Monday", with or without a query. Returns dated snippets.`,
      input: z
        .object({
          query: z.string().min(1).max(200).optional(),
          from: isoDay.optional(),
          to: isoDay.optional(),
          limit: z.number().int().min(1).max(40).default(8),
        })
        .refine((i) => i.query || i.from || i.to, 'Give a query or a date range.'),
      tier: 'SAFE',
      summarize: ({ query, from, to }) =>
        `Search past conversations${query ? ` for "${query}"` : ''}${from || to ? ` (${from ?? '…'} to ${to ?? '…'})` : ''}`,
      async run({ query, from, to, limit }) {
        const range = localDayRange(from, to);
        const hits = query
          ? await m.retriever.findConversations(query, limit, range)
          : m.conversations.messagesBetween(
              range.from ?? '',
              range.to ?? '9999',
              Math.max(limit, 30),
            );
        return ok(
          hits.length
            ? hits
                .map(
                  (h) =>
                    `${h.createdAt.slice(0, 16).replace('T', ' ')} · ${h.title ?? 'untitled'} · ${h.role === 'user' ? 'sir' : 'assistant'}: ${h.snippet}`,
                )
                .join('\n')
            : 'Nothing found in past conversations.',
        );
      },
    }),
  ];
}

/** Phase 3 composition: vault + index + watcher + memory tool + retrieval + daily logs + curator + routines. */
export function createMemorySystem(s: Services) {
  const repos = createMemoryRepos(s.db);
  const emitChanged = (paths: string[]): void => s.emit('memory:changed', { vaultPaths: paths });
  // Late-bound so vault writes can index synchronously through the indexer below.
  let indexer: ReturnType<typeof createIndexer> | null = null;
  const vault = createVaultService({
    root: () => s.settings.get('vault.path'),
    repos,
    onWritten: (rel, content, mtime) => {
      indexer?.indexContent(rel, content, mtime, 'jarvis');
      if (rel.startsWith('Routines/')) void reloadRoutines();
    },
    onRemoved: (rel) => indexer?.remove(rel),
  });
  const reloadRoutines = (): Promise<void> =>
    loadRoutines(vault, repos, s.registry).catch((err: unknown) =>
      logger.warn({ err: errorMessage(err) }, 'routine load failed'),
    );
  indexer = createIndexer({ repos, vault, reloadRoutines });
  const watcher = createVaultWatcher({
    root: () => vault.root(),
    indexer,
    logger,
    onChange: emitChanged,
    onRoutinesChanged: reloadRoutines,
  });
  // Semantic search (isair/jarvis idea): on when the MiniLM model is downloaded (Settings → Memory).
  const semantic = createSemanticIndex({
    db: s.db,
    modelDir: join(s.userData, 'models', 'minilm-embed'),
    enabled: () => s.settings.get('memory.semanticSearch'),
    logger,
  });
  // Re-ranking (hindsight idea): on when the cross-encoder is downloaded (Settings → Memory).
  const reranker = createReranker({
    modelDir: join(s.userData, 'models', 'minilm-rerank'),
    enabled: () => s.settings.get('memory.rerank'),
    logger,
  });
  const retriever = createRetriever({
    vault,
    repos,
    conversations: s.conversations,
    semantic,
    reranker,
  });
  const convLogger = createConversationLogger(vault);
  const curator = createCurator({
    llm: () => s.llm,
    model: () => pickModel(s.settings, { purpose: 'curator' }),
    ledger: s.ledger,
    vault,
    retriever,
    repos,
    logger,
    signal: () => s.killSwitch.signal(),
    onApplied: (paths) => {
      emitChanged(paths);
      s.emit('notify', {
        level: 'info',
        message: `Jarvis updated ${paths.length} ${paths.length === 1 ? 'memory' : 'memories'}.`,
        action: 'memory',
      });
    },
  });

  s.registry.register(createMemoryTool(vault, emitChanged));
  for (const t of [
    ...searchTools({ retriever, conversations: s.conversations }),
    ...createRoutineTools(repos, () => s.tools),
    createBrowserRoutineTool(vault, s.browserTrail),
  ])
    s.registry.register(t);

  // Context for every turn (Agents.md §B1 dynamic block).
  s.slots.providers = {
    ...s.slots.providers,
    coreProfile: () => retriever.coreProfile().catch(() => ''),
    retrieve: (text) => retriever.buildContextBlock(text).catch(() => ''),
    routines: () =>
      repos.routines
        .all()
        .filter((r) => r.enabled)
        .map(
          (r) => `${r.name} (say: ${(JSON.parse(r.trigger_phrases_json) as string[]).join(' / ')})`,
        )
        .join('; '),
  };

  // After each turn: daily log + memory curation, never for /private conversations (Security.md §9).
  s.orchestrator.onTurnEnd(async (turn) => {
    if (turn.isPrivate || turn.outcome === 'error') return;
    const conv = s.conversations.get(turn.conversationId);
    if (s.settings.get('privacy.logConversationsToVault')) {
      try {
        const rel = await convLogger.append({
          conversationId: turn.conversationId,
          title: conv?.title ?? null,
          at: new Date(),
          source: turn.mode,
          userText: turn.userText,
          replyText: turn.replyText,
          actions: turn.toolSummaries,
          memoryUsed: retriever.searchMemories(turn.userText, 3).map((h) => h.vaultPath),
        });
        if (!conv?.vault_log_path) s.conversations.setVaultLogPath(turn.conversationId, rel);
      } catch (err) {
        logger.warn({ err: errorMessage(err) }, 'conversation log failed');
      }
    }
    if (turn.replyText.trim()) curator.schedule(turn.conversationId, turn.userText, turn.replyText);
    void semantic.sync();
  });

  /** Database.md §8.1: a human-readable mirror of the reminders table. */
  async function writeRemindersMirror(): Promise<void> {
    if (!s.settings.get('onboarding.complete')) return;
    const fmt = (iso: string): string =>
      new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const upcoming = s.reminders.upcoming().map((r) => `- [ ] ${fmt(r.due_at)} — ${r.text}`);
    const recent = s.reminders
      .recent(20)
      .filter((r) => r.status !== 'scheduled')
      .map((r) => `- [x] ${fmt(r.due_at)} — ${r.text} (${r.status})`);
    const body = `# Reminders\n\n_Maintained by Jarvis. Ask Jarvis to change reminders; edits here are not read back._\n\n## Upcoming\n${upcoming.join('\n') || '- (none)'}\n\n## Recent\n${recent.join('\n') || '- (none)'}\n`;
    const rel = 'Tasks/Reminders.md';
    const current = vault.exists(rel) ? await vault.read(rel) : null;
    await vault.write(rel, body, current ? { expectedHash: current.hash } : {});
  }
  s.remindersChangedListeners.add(() => void writeRemindersMirror().catch(() => undefined));
  s.reminderListeners.add(() => void writeRemindersMirror().catch(() => undefined));

  /** Memory tidy-up (ruflo idea, made safe): duplicate-looking notes become review suggestions. */
  function tidy(): number {
    let added = 0;
    for (const p of findDuplicates(repos.memories.under('Memory/'))) {
      const reason = tidyReason(p);
      if (repos.review.seen(reason)) continue; // suggested before, or Sir already said no
      repos.review.add({
        op: 'UPDATE',
        targetPath: p.keep,
        proposedMarkdown: p.missing.join('\n') || null,
        reason,
        conversationId: null,
      });
      added++;
    }
    if (added)
      s.emit('notify', {
        level: 'info',
        message: `${added} memory ${added === 1 ? 'note looks' : 'notes look'} like duplicates: check Memory → Review.`,
        action: 'memory',
      });
    return added;
  }
  let tidyTimer: ReturnType<typeof setInterval> | null = null;

  /** Weekly reflection (hindsight idea): when on, set up, and neither the note nor the last run is a week old. */
  const reflectStamp = join(s.userData, 'memory-reflect-last.txt');
  async function reflectIfDue(): Promise<number> {
    if (!s.settings.get('memory.reflect') || !s.settings.get('onboarding.complete')) return 0;
    const notes = repos.memories.under('Memory/');
    const last = existsSync(reflectStamp) ? Date.parse(readFileSync(reflectStamp, 'utf8')) : 0;
    if (Date.now() - (last || 0) < REFLECT_EVERY_MS) return 0;
    if (!reflectDue(notes.find((n) => n.vault_path === `Memory/${OBSERVATIONS_PATH}`))) return 0;
    const r = await reflect({
      llm: () => s.llm,
      model: () => pickModel(s.settings, { purpose: 'curator' }),
      ledger: s.ledger,
      curator,
      notes: () => notes,
      signal: () => s.killSwitch.signal(),
    });
    // Stamped only after a run that finished: a failed call (offline, budget) tries again tomorrow.
    writeFileSync(reflectStamp, new Date().toISOString(), 'utf8');
    if (r.queued)
      s.emit('notify', {
        level: 'info',
        message: `Weekly reflection: ${r.queued} ${r.queued === 1 ? 'observation waits' : 'observations wait'} for you in Memory → Review.`,
        action: 'memory',
      });
    return r.applied.length;
  }

  /** Startup (App-flow.md §2 step 4): skeleton, catch up on edits made while Jarvis was closed, watch. */
  async function start(): Promise<void> {
    const missing = !vault.exists('');
    await vault.ensureSkeleton();
    if (missing)
      s.emit('notify', {
        level: 'warn',
        message: `Memory vault not found; created it at ${vault.root()}.`,
      });
    for (const rel of await vault.walk())
      await indexer?.indexFile(rel, 'external').catch(() => false);
    await reloadRoutines();
    await watcher.start();
    void semantic.sync(); // background: embeds what's new since last time
    // Once a day, starting a few minutes after start-up when nothing else is busy.
    if (!tidyTimer && !s.isTest) {
      const run = (): void =>
        void Promise.resolve()
          .then(tidy)
          .then(reflectIfDue)
          .catch((err: unknown) =>
            logger.warn({ err: errorMessage(err) }, 'memory tidy/reflection failed'),
          );
      setTimeout(run, TIDY_FIRST_MS).unref();
      tidyTimer = setInterval(run, TIDY_EVERY_MS);
      tidyTimer.unref();
    }
  }

  return {
    repos,
    vault,
    indexer,
    watcher,
    retriever,
    semantic,
    convLogger,
    curator,
    tidy,
    reflectIfDue,
    start,
    reloadRoutines,
  };
}

export type MemorySystem = ReturnType<typeof createMemorySystem>;
