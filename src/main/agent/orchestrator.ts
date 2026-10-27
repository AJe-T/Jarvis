import type { EventPayload } from '@shared/ipc-contract';
import type { EventChannel } from '@shared/ipc-channels';
import type { Citation, UiMessage } from '@shared/types';
import { JarvisError, errorMessage, isAbortError } from '../errors';
import { newId, nowIso } from '../lib/util';
import type { Logger } from '../logging/logger';
import { redact } from '../security/redact';
import { redactContent } from '../security/redact-content';
import type { KillSwitch } from '../security/kill-switch';
import type {
  ConversationRow,
  ConversationsRepo,
  MessageRow,
  NewMessage,
} from '../db/repos/conversations-repo';
import { toSummary } from '../db/repos/conversations-repo';
import { toUiToolCall, type ToolCallsRepo } from '../db/repos/tool-calls-repo';
import type { BudgetGuard } from '../llm/budget-guard';
import type { UsageLedger } from '../llm/usage-ledger';
import type { LlmClient, MessageParam, ToolUseBlock } from '../llm/types';
import type { SettingsService } from '../settings/settings-service';
import { isPoolExhausted } from '../llm/pool/pool';
import { runAgentLoop, textOfContent, type ToolRuntime, type TurnContext } from './agent-loop';
import type { PoolTurns } from './front-door';
import type { AssistantStateHub } from './assistant-state';
import { historyWindow, type ContextBuilder } from './context-builder';
import { createMoodFilter, stripMood } from './mood';
import { pickModel, type TurnPurpose } from './model-router';
import {
  COMPACT_PROMPT,
  STATIC_PERSONA_AND_RULES,
  SUMMARY_PROMPT,
  TITLE_PROMPT,
} from './prompts/orchestrator';
import { contextStats, type ContextStats } from './context-stats';
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
  /** Who asked: Sir ('chat', default) or an automation ('briefing', 'task', 'research'…). */
  purpose?: TurnPurpose | undefined;
  /** Instant command: run this one tool (through the policy, as always) and skip the model. */
  direct?: DirectAction | undefined;
}

export interface DirectAction {
  tool: string;
  input: Record<string, unknown>;
  /** Spoken when the tool succeeds. */
  ack: string;
}

export interface TurnInfo {
  turnId: string;
  conversationId: string;
  mode: 'text' | 'voice';
  userText: string;
  isPrivate: boolean;
  purpose: TurnPurpose;
  direct?: DirectAction | undefined;
  /** Sir's own plain request (no attachments, not an automation): the fast path may answer it. */
  fastPathOk?: boolean;
  /** Seq of this turn's own user message (a later message may already be queued behind it). */
  userSeq?: number;
}

export interface TurnEnd extends TurnInfo {
  outcome: 'end_turn' | 'max_iterations' | 'aborted' | 'error';
  replyText: string;
  toolSummaries: string[];
  /** What the safety layer stopped in this turn (the automation watchdog reports it to Sir). */
  watch?: TurnWatch;
}

export interface TurnWatch {
  /** The turn read untrusted content (Security.md §6.3). */
  tainted: boolean;
  /** Tools in call order: whether each ran at all (not declined/blocked) and succeeded. */
  tools: Array<{ name: string; ran: boolean; ok: boolean }>;
  /** Outside text that tried to instruct the AI (injection-scan.ts). */
  injection?: string;
  /** Summaries of actions the policy blocked. */
  blocked: string[];
  /** Summaries of actions that waited for approval and nobody answered. */
  unanswered: string[];
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
  /** ADR-030: a plain PC command Sir typed or said → one tool, no model call (agent/fast-path). */
  fastPath?: (text: string) => Promise<DirectAction | null>;
  /** AI Router Phase 2: the free pool answers simple chats (front door) or when Claude can't. */
  poolTurns?: PoolTurns;
}

const FRONT_DOOR_NOTICE = {
  on: "Front door: a free AI answered this simple question, so Claude wasn't used.",
  budget:
    "Today's Claude budget is over 80% used, so a free AI answered this simple question (front door).",
} as const;

const PRIVATE_PREFIX = /^\/private\s+/i;
/** The per-turn context block (date, memories, skills…) before anything was measured. */
const BASE_DYNAMIC_TOKENS = 1500;
/** Manual compaction reads at most this much of the transcript (the newest part). */
const COMPACT_MAX_CHARS = 150_000;

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

  function persist(conversationId: string, messages: NewMessage[]): MessageRow[] {
    const clean = messages.map((m) => ({
      ...m,
      content: redactContent(m.content),
      // Mood tags stay in the API content (history) but not in search text or summaries.
      textPlain: redact(stripMood(m.textPlain)),
    }));
    return deps.conversations.appendMessages(conversationId, clean);
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
    maxTokens = purpose === 'title' ? 30 : 400,
  ): Promise<string> {
    const model = pickModel(deps.settings, { purpose });
    const msg = await deps.llm().stream(
      {
        model,
        max_tokens: maxTokens,
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

  /** Rough size of what every turn sends besides the conversation: the instructions and the tool list. */
  function baseTokens(): number {
    const tools = JSON.stringify(deps.tools().definitions()).length;
    return Math.ceil((STATIC_PERSONA_AND_RULES.length + tools) / 4) + BASE_DYNAMIC_TOKENS;
  }

  function busyWith(conversationId: string): boolean {
    return (
      running?.info.conversationId === conversationId ||
      queue.some((q) => q.info.conversationId === conversationId)
    );
  }

  function emitNotice(info: TurnInfo, text: string): void {
    const message: UiMessage = { id: newId('n_'), role: 'notice', text, createdAt: nowIso() };
    deps.emit('chat:message', {
      turnId: info.turnId,
      conversationId: info.conversationId,
      message,
    });
  }

  async function modelTurn(
    info: TurnInfo,
    ctx: TurnContext,
    onText: (delta: string) => void,
    toolUseIds: string[],
    /** After each model step: a later step may open with its own mood tag. */
    onStepEnd: () => void,
    /** Something of this turn was saved to the history. */
    onPersist?: () => void,
  ): Promise<{ outcome: TurnEnd['outcome']; text: string; citations: Citation[] }> {
    const system = await deps.context.system({
      conversationId: info.conversationId,
      mode: info.mode,
      userText: info.userText,
    });
    return (deps.loop?.() ?? runAgentLoop)(
      {
        llm: deps.llm(),
        tools: deps.tools(),
        budget: deps.budget,
        ledger: deps.ledger,
        maxIterations: deps.settings.get('agent.maxIterations'),
      },
      ctx,
      {
        model: pickModel(deps.settings, { purpose: info.purpose, text: info.userText }),
        system,
        messages: deps.context.history(info.conversationId),
        withCache: deps.context.withCacheOnLastBlock,
      },
      {
        onText,
        persist: (msgs) => {
          onPersist?.();
          persist(info.conversationId, msgs);
        },
        onStep: (msg) => {
          for (const b of msg.content) if (b.type === 'tool_use') toolUseIds.push(b.id);
          onStepEnd();
        },
      },
    );
  }

  /**
   * AI Router Phase 2 (Security.md §16.15): the front door may send a simple, non-private chat to
   * the free pool first; Claude answers otherwise. Each side covers for the other, never silently
   * (a notice in the chat, and the pool's trail line), and never once text is on screen.
   */
  async function answer(
    info: TurnInfo,
    ctx: TurnContext,
    onText: (delta: string) => void,
    toolUseIds: string[],
    onStepEnd: () => void,
  ): Promise<{ outcome: TurnEnd['outcome']; text: string; citations: Citation[] }> {
    const pt = deps.poolTurns;
    if (!pt) return modelTurn(info, ctx, onText, toolUseIds, onStepEnd);
    let streamed = false;
    const watched = (d: string): void => {
      if (d) streamed = true;
      onText(d);
    };
    const hooks = {
      onText: watched,
      persist: (m: NewMessage[]) => persist(info.conversationId, m),
      toolUseIds,
    };
    const door = await pt.frontDoor(info, ctx);
    if (door)
      try {
        const r = await pt.run(info, ctx, hooks, 'front-door');
        emitNotice(info, FRONT_DOOR_NOTICE[door]);
        return r;
      } catch (err) {
        if (streamed || ctx.signal.aborted || !isPoolExhausted(err)) throw err;
        emitNotice(info, 'The free AIs were busy, so Claude answered.');
      }
    const ranTools = toolUseIds.length;
    let saved = false;
    try {
      return await modelTurn(info, ctx, watched, toolUseIds, onStepEnd, () => (saved = true));
    } catch (err) {
      // Only a turn Claude left untouched: nothing shown, run or saved (no second answer).
      const fresh = !streamed && !saved && toolUseIds.length === ranTools && !ctx.signal.aborted;
      if (!fresh || !(await pt.fallbackOk(info, ctx, err))) throw err;
      const why = err instanceof JarvisError && err.userMessage ? `${err.userMessage} ` : '';
      emitNotice(info, `${why}A free AI answered instead of Claude.`);
      return pt.run(info, ctx, hooks, 'fallback');
    }
  }

  /** Instant command (idea from Priler/jarvis): one tool, no model call, result kept in the history as text. */
  async function directTurn(
    info: TurnInfo,
    direct: DirectAction,
    ctx: TurnContext,
    onText: (delta: string) => void,
    toolUseIds: string[],
  ): Promise<{ outcome: TurnEnd['outcome']; text: string; citations: Citation[] }> {
    const id = `toolu_direct_${newId()}`;
    toolUseIds.push(id);
    const res = await deps
      .tools()
      .execute(
        { type: 'tool_use', id, name: direct.tool, input: direct.input } as ToolUseBlock,
        ctx,
      );
    if (ctx.signal.aborted) return { outcome: 'aborted', text: '', citations: [] };
    const detail = typeof res.content === 'string' ? res.content : textOfContent(res.content ?? []);
    const spoken = res.is_error
      ? "That didn't go to plan, sir. The details are on screen."
      : direct.ack;
    const text = `<spoken>${spoken}</spoken>

${detail.trim()}`;
    onText(text);
    persist(info.conversationId, [
      { role: 'assistant', content: [{ type: 'text', text }], textPlain: text, source: 'text' },
    ]);
    return { outcome: 'end_turn', text, citations: [] };
  }

  async function runTurn(info: TurnInfo, controller: AbortController): Promise<void> {
    const signal = AbortSignal.any([controller.signal, deps.killSwitch.signal()]);
    const ctx: TurnContext = {
      turnId: info.turnId,
      conversationId: info.conversationId,
      mode: info.mode,
      purpose: info.purpose,
      signal,
      taint: { tainted: false },
    };
    const toolUseIds: string[] = [];
    let outcome: TurnEnd['outcome'] = 'error';
    let replyText = '';
    for (const l of startListeners) l(info);
    deps.state.set('THINKING');
    const forward = (delta: string): void => {
      if (!delta) return;
      deps.emit('chat:delta', {
        turnId: info.turnId,
        conversationId: info.conversationId,
        textDelta: delta,
      });
      for (const l of deltaListeners) l(info, delta);
    };
    // A leading <mood> tag never reaches the screen or the voice; the orb takes its colour.
    const mood = createMoodFilter((m) => deps.emit('assistant:mood', { mood: m }));
    const onText = (delta: string): void => forward(mood.push(delta));
    try {
      const direct =
        info.direct ??
        (info.fastPathOk && deps.fastPath
          ? await deps.fastPath(info.userText).catch((e: unknown) => {
              log.warn({ err: errorMessage(e) }, 'fast path failed; asking the model');
              return null;
            })
          : null);
      const result = direct
        ? await directTurn(info, direct, ctx, onText, toolUseIds)
        : await answer(info, ctx, onText, toolUseIds, () => forward(mood.flush()));
      forward(mood.flush());
      outcome = result.outcome;
      replyText = stripMood(result.text);
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
    const rows = deps.toolCalls.byToolUseIds(toolUseIds);
    const toolSummaries = rows.map(
      (t) => `\`${t.tool_name}\` ${t.human_summary} ${t.status === 'success' ? '✅' : '❌'}`,
    );
    const watch: TurnWatch = {
      tainted: ctx.taint.tainted,
      tools: rows.map((t) => ({
        name: t.tool_name,
        ran: t.status !== 'not_run',
        ok: t.status === 'success',
      })),
      ...(ctx.taint.injection ? { injection: ctx.taint.injection } : {}),
      blocked: rows.filter((t) => t.decision === 'blocked').map((t) => t.human_summary),
      unanswered: rows
        .filter((t) => t.decision === 'denied' && t.decided_by === 'timeout')
        .map((t) => t.human_summary),
    };
    await notifyEnd({ ...info, outcome, replyText, toolSummaries, watch });
    if (conv && outcome !== 'error') {
      void maybeTitle(conv, info.userText, replyText).catch((e: unknown) =>
        log.warn({ err: errorMessage(e) }, 'titler failed'),
      );
      void maybeSummarize(conv.id).catch((e: unknown) =>
        log.warn({ err: errorMessage(e) }, 'summary failed'),
      );
    }
  }

  async function notifyEnd(end: TurnEnd): Promise<void> {
    for (const l of endListeners) {
      try {
        await l(end);
      } catch (e) {
        log.warn({ err: errorMessage(e) }, 'turn-end listener failed');
      }
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
      const [own] = persist(conv.id, [
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
        purpose: req.purpose ?? 'chat',
        ...(req.direct ? { direct: req.direct } : {}),
        fastPathOk: (req.purpose ?? 'chat') === 'chat' && !req.attachments?.length,
        ...(own ? { userSeq: own.seq } : {}),
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
          // A turn cancelled before it started still ends, so listeners (automations) can clean up.
          void notifyEnd({ ...q.info, outcome: 'aborted', replyText: '', toolSummaries: [] });
        }
      }
    },

    /** Context meter (idea from LibreChat): how full the next request's context is. */
    contextStats(conversationId: string): ContextStats {
      const conv = deps.conversations.get(conversationId);
      if (!conv)
        throw new JarvisError('NOT_FOUND', 'conversation not found', 'That conversation is gone.');
      return contextStats(
        deps.conversations.messages(conversationId),
        conv.summary_upto_seq,
        baseTokens(),
      );
    },

    /**
     * Manual compaction (LibreChat's "compact"): folds the whole conversation so far into its
     * running summary, so the next turn starts light. Refused while a turn of it is running.
     */
    async compact(conversationId: string): Promise<{ summarizedMessages: number }> {
      const conv = deps.conversations.get(conversationId);
      if (!conv)
        throw new JarvisError('NOT_FOUND', 'conversation not found', 'That conversation is gone.');
      if (busyWith(conversationId))
        throw new JarvisError(
          'INVALID',
          'busy',
          'Let Jarvis finish (or stop him) before compacting.',
        );
      const rows = deps.conversations.messages(conversationId);
      const pending = rows.filter((r) => r.seq > conv.summary_upto_seq);
      const last = rows.at(-1);
      if (!last || pending.length === 0) return { summarizedMessages: 0 };
      const transcript = pending
        .filter((r) => r.text_plain)
        .map((r) => `${r.role === 'user' ? 'Sir' : 'Assistant'}: ${r.text_plain.slice(0, 2000)}`)
        .join('\n')
        .slice(-COMPACT_MAX_CHARS);
      const prior = conv.summary ? `Previous summary: ${conv.summary}\n\n` : '';
      const summary = await oneShot(
        'summary',
        COMPACT_PROMPT,
        `${prior}${transcript || '(only tool activity so far)'}`,
        conversationId,
        deps.killSwitch.signal(),
        700,
      );
      if (!summary)
        throw new JarvisError(
          'INTERNAL',
          'empty summary',
          'The summary came back empty; nothing changed.',
        );
      deps.conversations.setSummary(conversationId, redact(summary), last.seq);
      const updated = deps.conversations.get(conversationId);
      if (updated) deps.emit('conversation:updated', toSummary(updated));
      log.info({ conversationId, messages: pending.length }, 'conversation compacted');
      return { summarizedMessages: pending.length };
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
