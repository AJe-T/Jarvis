import type { EventPayload } from '@shared/ipc-contract';
import type { EventChannel } from '@shared/ipc-channels';
import type { UiMessage } from '@shared/types';
import { JarvisError, errorMessage, isAbortError } from '../errors';
import { newId, nowIso } from '../lib/util';
import type { Logger } from '../logging/logger';
import { redact } from '../security/redact';
import { redactContent } from '../security/redact-content';
import type { KillSwitch } from '../security/kill-switch';
import type {
  ConversationRow,
  ConversationsRepo,
  NewMessage,
} from '../db/repos/conversations-repo';
import { toSummary } from '../db/repos/conversations-repo';
import { toUiToolCall, type ToolCallsRepo } from '../db/repos/tool-calls-repo';
import type { BudgetGuard } from '../llm/budget-guard';
import type { UsageLedger } from '../llm/usage-ledger';
import type { LlmClient, MessageParam } from '../llm/types';
import type { SettingsService } from '../settings/settings-service';
import { runAgentLoop, textOfContent, type ToolRuntime, type TurnContext } from './agent-loop';
import type { AssistantStateHub } from './assistant-state';
import { historyWindow, type ContextBuilder } from './context-builder';
import { pickModel } from './model-router';
import { SUMMARY_PROMPT, TITLE_PROMPT } from './prompts/orchestrator';
import { displayText } from './ui-history';

export type Emit = <E extends EventChannel>(event: E, payload: EventPayload<E>) => void;

export interface Attachment {
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'application/pdf';
  dataBase64: string;
}

export interface SendRequest {
  conversationId?: string | undefined;
  text: string;
  source: 'text' | 'voice';
  attachments?: Attachment[] | undefined;
}

export interface TurnInfo {
  turnId: string;
  conversationId: string;
  mode: 'text' | 'voice';
  userText: string;
  isPrivate: boolean;
}

export interface TurnEnd extends TurnInfo {
  outcome: 'end_turn' | 'max_iterations' | 'aborted' | 'error';
  replyText: string;
  toolSummaries: string[];
}

export interface OrchestratorDeps {
  conversations: ConversationsRepo;
  toolCalls: ToolCallsRepo;
  context: ContextBuilder;
  llm: () => LlmClient;
  tools: () => ToolRuntime;
  /** Picks the chat loop per turn: Messages API (default) or the Claude subscription (ADR-010). */
  loop?: () => typeof runAgentLoop;
  budget: BudgetGuard;
  ledger: UsageLedger;
  settings: SettingsService;
  killSwitch: KillSwitch;
  state: AssistantStateHub;
  emit: Emit;
  logger: Logger;
}

const PRIVATE_PREFIX = /^\/private\s+/i;

function userContent(text: string, attachments: Attachment[] = []): MessageParam['content'] {
  const blocks: Exclude<MessageParam['content'], string> = attachments.map((a) =>
    a.mime === 'application/pdf'
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: a.dataBase64,
          },
        }
      : {
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: a.mime, data: a.dataBase64 },
        },
  );
  blocks.push({ type: 'text', text });
  return blocks;
}

export function createOrchestrator(deps: OrchestratorDeps) {
  const log = deps.logger.child({ module: 'agent.orchestrator' });
  const queue: Array<{ info: TurnInfo; controller: AbortController }> = [];
  let running: { info: TurnInfo; controller: AbortController } | null = null;
  const deltaListeners = new Set<(turn: TurnInfo, delta: string) => void>();
  const startListeners = new Set<(turn: TurnInfo) => void>();
  const endListeners = new Set<(turn: TurnEnd) => void | Promise<void>>();

  function persist(conversationId: string, messages: NewMessage[]): void {
    const clean = messages.map((m) => ({
      ...m,
      content: redactContent(m.content),
      textPlain: redact(m.textPlain),
    }));
    deps.conversations.appendMessages(conversationId, clean);
  }

  function ensureConversation(req: SendRequest, isPrivate: boolean): ConversationRow {
    const existing = req.conversationId ? deps.conversations.get(req.conversationId) : undefined;
    if (existing) {
      deps.conversations.touch(existing.id, req.source);
      return existing;
    }
    return deps.conversations.create(req.source, isPrivate);
  }

  async function oneShot(
    purpose: 'title' | 'summary',
    system: string,
    text: string,
    conversationId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const model = pickModel(deps.settings, { purpose });
    const msg = await deps.llm().stream(
      {
        model,
        max_tokens: purpose === 'title' ? 30 : 400,
        system,
        messages: [{ role: 'user', content: text }],
      },
      { signal },
    );
    deps.ledger.record(msg, purpose, conversationId);
    return textOfContent(msg.content).trim();
  }

  async function maybeTitle(conv: ConversationRow, userText: string, reply: string): Promise<void> {
    if (conv.title || !reply) return;
    const title = await oneShot(
      'title',
      TITLE_PROMPT,
      `Sir: ${userText}\n\nAssistant: ${reply.slice(0, 1500)}`,
      conv.id,
      deps.killSwitch.signal(),
    );
    const clean = title.replace(/^["'\s]+|["'\s.]+$/g, '').slice(0, 80);
    if (!clean) return;
    deps.conversations.setTitle(conv.id, clean);
    const updated = deps.conversations.get(conv.id);
    if (updated) deps.emit('conversation:updated', toSummary(updated));
  }

  /** API-Guide.md §3.5: messages older than the 30-message window are folded into a rolling summary. */
  async function maybeSummarize(conversationId: string): Promise<void> {
    const conv = deps.conversations.get(conversationId);
    if (!conv) return;
    const rows = deps.conversations.messages(conversationId);
    const { cutSeq } = historyWindow(rows, conv.summary_upto_seq);
    const pending = rows.filter((r) => r.seq > conv.summary_upto_seq && r.seq <= cutSeq);
    if (pending.length < 2) return;
    const transcript = pending
      .filter((r) => r.text_plain)
      .map((r) => `${r.role === 'user' ? 'Sir' : 'Assistant'}: ${r.text_plain.slice(0, 2000)}`)
      .join('\n');
    const prior = conv.summary ? `Previous summary: ${conv.summary}\n\n` : '';
    const summary = await oneShot(
      'summary',
      SUMMARY_PROMPT,
      `${prior}${transcript}`,
      conversationId,
      deps.killSwitch.signal(),
    );
    if (summary) deps.conversations.setSummary(conversationId, redact(summary), cutSeq);
  }

  function emitNotice(info: TurnInfo, text: string): void {
    const message: UiMessage = { id: newId('n_'), role: 'notice', text, createdAt: nowIso() };
    deps.emit('chat:message', {
      turnId: info.turnId,
      conversationId: info.conversationId,
      message,
    });
  }

  async function runTurn(info: TurnInfo, controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([controller.signal, deps.killSwitch.signal()]);
    const ctx: TurnContext = {
      turnId: info.turnId,
      conversationId: info.conversationId,
      mode: info.mode,
      purpose: 'chat',
      signal,
      taint: { tainted: false },
    };
    const toolUseIds: string[] = [];
    let outcome: TurnEnd['outcome'] = 'error';
    let replyText = '';
    for (const l of startListeners) l(info);
    deps.state.set('THINKING');
    try {
      const system = await deps.context.system({
        conversationId: info.conversationId,
        mode: info.mode,
        userText: info.userText,
      });
      const result = await (deps.loop?.() ?? runAgentLoop)(
        {
          llm: deps.llm(),
          tools: deps.tools(),
          budget: deps.budget,
          ledger: deps.ledger,
          maxIterations: deps.settings.get('agent.maxIterations'),
        },
        ctx,
        {
          model: pickModel(deps.settings, { purpose: 'chat', text: info.userText }),
          system,
          messages: deps.context.history(info.conversationId),
          withCache: deps.context.withCacheOnLastBlock,
        },
        {
          onText: (delta) => {
            deps.emit('chat:delta', {
              turnId: info.turnId,
              conversationId: info.conversationId,
              textDelta: delta,
            });
            for (const l of deltaListeners) l(info, delta);
          },
          persist: (msgs) => persist(info.conversationId, msgs),
          onStep: (msg) => {
            for (const b of msg.content) if (b.type === 'tool_use') toolUseIds.push(b.id);
          },
        },
      );
      outcome = result.outcome;
      replyText = result.text;
      const toolCalls = deps.toolCalls.byToolUseIds(toolUseIds).map(toUiToolCall);
      const message: UiMessage = {
        id: info.turnId,
        role: 'assistant',
        text: displayText(result.text),
        createdAt: nowIso(),
        ...(result.outcome === 'aborted' ? { interrupted: true } : {}),
        ...(result.citations.length ? { citations: result.citations } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      };
      deps.emit('chat:message', {
        turnId: info.turnId,
        conversationId: info.conversationId,
        message,
      });
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        outcome = 'aborted';
        emitNotice(info, 'Stopped.');
      } else {
        const userMsg =
          err instanceof JarvisError && err.userMessage
            ? err.userMessage
            : `Something went wrong: ${errorMessage(err)}`;
        log.error(
          { err: errorMessage(err), code: err instanceof JarvisError ? err.code : undefined },
          'turn failed',
        );
        emitNotice(info, userMsg);
        const action =
          err instanceof JarvisError &&
          (err.code === 'LLM_AUTH' || err.code === 'LLM_NO_KEY' || err.code === 'BUDGET_EXCEEDED')
            ? ('settings:brain' as const)
            : undefined;
        deps.emit('notify', { level: 'error', message: userMsg, ...(action ? { action } : {}) });
        deps.state.set('ERROR', userMsg);
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      const s = deps.state.get();
      if (s === 'THINKING' || s === 'ACTING' || s === 'ERROR' || s === 'AWAITING_CONFIRMATION')
        deps.state.set('IDLE');
    }

    const conv = deps.conversations.get(info.conversationId);
    if (conv) deps.emit('conversation:updated', toSummary(conv));
    const toolSummaries = deps.toolCalls
      .byToolUseIds(toolUseIds)
      .map((t) => `\`${t.tool_name}\` ${t.human_summary} ${t.status === 'success' ? '✅' : '❌'}`);
    const end: TurnEnd = { ...info, outcome, replyText, toolSummaries };
    for (const l of endListeners) {
      try {
        await l(end);
      } catch (e) {
        log.warn({ err: errorMessage(e) }, 'turn-end listener failed');
      }
    }
    if (conv && outcome !== 'error') {
      void maybeTitle(conv, info.userText, replyText).catch((e: unknown) =>
        log.warn({ err: errorMessage(e) }, 'titler failed'),
      );
      void maybeSummarize(conv.id).catch((e: unknown) =>
        log.warn({ err: errorMessage(e) }, 'summary failed'),
      );
    }
  }

  async function pump(): Promise<void> {
    if (running) return;
    const next = queue.shift();
    if (!next) return;
    running = next;
    try {
      await runTurn(next.info, next.controller);
    } finally {
      running = null;
      void pump();
    }
  }

  return {
    send(req: SendRequest): { conversationId: string; turnId: string } {
      const isPrivate = PRIVATE_PREFIX.test(req.text);
      const text = req.text.replace(PRIVATE_PREFIX, '').trim();
      if (!text) throw new JarvisError('INVALID', 'empty message', 'Type a message first.');
      const conv = ensureConversation(req, isPrivate);
      const turnId = newId('t_');
      persist(conv.id, [
        {
          role: 'user',
          content: userContent(text, req.attachments),
          textPlain: text,
          source: req.source,
        },
      ]);
      const info: TurnInfo = {
        turnId,
        conversationId: conv.id,
        mode: req.source,
        userText: text,
        isPrivate: conv.is_private === 1,
      };
      // Typed messages are shown optimistically by the renderer; spoken ones appear once recognised.
      if (req.source === 'voice') {
        const message: UiMessage = {
          id: newId('m_'),
          role: 'user',
          text,
          source: 'voice',
          createdAt: nowIso(),
        };
        deps.emit('chat:message', { turnId, conversationId: conv.id, message });
      }
      deps.emit('conversation:updated', toSummary(deps.conversations.get(conv.id) ?? conv));
      queue.push({ info, controller: new AbortController() });
      void pump();
      return { conversationId: conv.id, turnId };
    },

    /** Cancels one turn (or the running one when no id is given). */
    cancel(turnId?: string): void {
      if (running && (!turnId || running.info.turnId === turnId))
        running.controller.abort(new JarvisError('CANCELLED', 'cancelled by Sir'));
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i];
        if (q && (!turnId || q.info.turnId === turnId)) {
          q.controller.abort();
          queue.splice(i, 1);
        }
      }
    },

    isBusy: () => running !== null || queue.length > 0,
    currentTurn: () => running?.info ?? null,
    onDelta: (l: (turn: TurnInfo, delta: string) => void) => (
      deltaListeners.add(l),
      () => deltaListeners.delete(l)
    ),
    onTurnStart: (l: (turn: TurnInfo) => void) => (
      startListeners.add(l),
      () => startListeners.delete(l)
    ),
    onTurnEnd: (l: (turn: TurnEnd) => void | Promise<void>) => (
      endListeners.add(l),
      () => endListeners.delete(l)
    ),
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
