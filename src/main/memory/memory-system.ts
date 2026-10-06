import { z } from 'zod';
import { createMemoryRepos } from '../db/repos/memory-repos';
import { errorMessage } from '../errors';
import { logger } from '../logging/logger';
import { pickModel } from '../agent/model-router';
import type { Services } from '../services';
import { defineTool, ok, type Tool } from '../tools/types';
import { createConversationLogger } from './conversation-logger';
import { createCurator } from './curator';
import { createIndexer } from './indexer';
import { createMemoryTool } from './memory-tool';
import { createRetriever } from './retriever';
import { createRoutineTools, loadRoutines } from './routines';
import { createVaultService } from './vault-service';
import { createVaultWatcher } from './vault-watcher';

function searchTools(m: { retriever: ReturnType<typeof createRetriever> }): Tool[] {
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
        const hits = m.retriever.searchMemories(query, limit);
        return ok(
          hits.length
            ? hits.map((h) => `${h.vaultPath} — ${h.title}\n${h.snippet}`).join('\n\n')
            : 'No matching memories.',
        );
      },
    }),
    defineTool({
      name: 'search_conversations',
      description:
        'Search past conversations with sir (all days). Use for "what did we decide/discuss about X" or "what did we talk about yesterday". Returns dated snippets.',
      input: z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      tier: 'SAFE',
      summarize: ({ query }) => `Search past conversations for "${query}"`,
      async run({ query, limit }) {
        const hits = m.retriever.searchConversations(query, limit);
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
  const retriever = createRetriever({ vault, repos, conversations: s.conversations });
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
  for (const t of [...searchTools({ retriever }), ...createRoutineTools(repos, () => s.tools)])
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
  }

  return { repos, vault, indexer, watcher, retriever, convLogger, curator, start, reloadRoutines };
}

export type MemorySystem = ReturnType<typeof createMemorySystem>;
