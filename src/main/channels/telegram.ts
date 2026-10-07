import { randomInt } from 'node:crypto';
import type { TurnEnd } from '../agent/orchestrator';
import { errorMessage } from '../errors';
import { logger } from '../logging/logger';
import { redact } from '../security/redact';
import type { Services } from '../services';
import type { ConfirmRequestEvent } from '../tools/confirmation-broker';

/**
 * Telegram channel (ideas from OpenJarvis's channels): Sir talks to Jarvis from his phone through his
 * own bot. Only the one chat paired with a code shown in Settings is answered. Messages become normal
 * turns with every safety rule; non-destructive confirmations get Approve/Deny buttons, destructive
 * ones must be approved at the PC. Replies leave the PC via Telegram's servers.
 */

const API = 'https://api.telegram.org';
const MAX_MESSAGE = 4000;
const CONVERSATION_GAP_MS = 12 * 3_600_000;

interface Update {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { first_name?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

export interface TelegramStatus {
  running: boolean;
  paired: boolean;
  botName: string | null;
  pairingCode: string | null;
  error: string | null;
}

/** Splits long replies at paragraph or line breaks under Telegram's 4096-character limit. */
export function chunkMessage(text: string, max = MAX_MESSAGE): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = Math.max(
      rest.lastIndexOf('\n\n', max),
      rest.lastIndexOf('\n', max),
      rest.lastIndexOf(' ', max),
    );
    const at = cut > max / 2 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function createTelegramChannel(
  s: Services,
  deps: { fetch?: typeof fetch; pollTimeoutSec?: number } = {},
) {
  const f = deps.fetch ?? fetch;
  const log = logger.child({ module: 'telegram' });
  let abort: AbortController | null = null;
  let offset = 0;
  let pairingCode: string | null = null;
  let botName: string | null = null;
  let lastError: string | null = null;
  /** Turns started from Telegram → the chat to answer. */
  const turns = new Map<string, number>();
  let conversation: { id: string; at: number } | null = null;
  const statusListeners = new Set<() => void>();
  const changed = (): void => statusListeners.forEach((l) => l());

  const token = (): string | undefined => s.secrets.get('telegram');
  const chatId = (): number | null => {
    const v = s.settings.get('telegram.chatId');
    return v ? Number(v) : null;
  };

  async function api<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const t = token();
    if (!t) throw new Error('No Telegram bot token.');
    const res = await f(`${API}/bot${t}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    // Never log the URL: it contains the bot token.
    if (!json.ok) throw new Error(`Telegram: ${json.description ?? res.status}`);
    return json.result as T;
  }

  const send = async (
    chat: number,
    text: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> => {
    for (const part of chunkMessage(text))
      await api('sendMessage', { chat_id: chat, text: part, ...extra });
  };

  async function onMessage(m: NonNullable<Update['message']>): Promise<void> {
    const text = (m.text ?? '').trim();
    const paired = chatId();
    if (paired === null) {
      if (
        pairingCode &&
        (text === pairingCode || text === `/start ${pairingCode}`) &&
        m.chat.type === 'private'
      ) {
        s.settings.set('telegram.chatId', String(m.chat.id));
        pairingCode = null;
        s.audit.append('user', 'telegram.paired', {});
        await send(m.chat.id, 'Paired with JARVIS. Send me anything you would type at your PC.');
        changed();
      }
      return;
    }
    if (m.chat.id !== paired) {
      s.audit.append('system', 'telegram.rejected', {});
      return;
    }
    if (!text) return void send(paired, 'I can only read text messages for now, sir.');
    if (/^\/stop\b/i.test(text)) {
      s.killSwitch.trigger('telegram');
      return void send(paired, 'Stopped everything, sir.');
    }
    const recent =
      conversation && Date.now() - conversation.at < CONVERSATION_GAP_MS
        ? conversation.id
        : undefined;
    const { conversationId, turnId } = s.orchestrator.send({
      text: text.replace(/^\/start\b\s*/i, '') || 'Hello',
      source: 'text',
      ...(recent ? { conversationId: recent } : {}),
    });
    conversation = { id: conversationId, at: Date.now() };
    turns.set(turnId, paired);
    void api('sendChatAction', { chat_id: paired, action: 'typing' }).catch(() => undefined);
  }

  async function onCallback(q: NonNullable<Update['callback_query']>): Promise<void> {
    const paired = chatId();
    if (paired === null || q.message?.chat.id !== paired) return;
    const m = /^cf:([\w-]+):(approve|deny)$/.exec(q.data ?? '');
    if (!m?.[1]) return;
    const ok = s.broker.respond(m[1], m[2] as 'approve' | 'deny', 'remote');
    await api('answerCallbackQuery', {
      callback_query_id: q.id,
      text: ok
        ? m[2] === 'approve'
          ? 'Approved'
          : 'Denied'
        : 'That request has expired or must be approved at the PC.',
    }).catch(() => undefined);
  }

  /** Confirmations for Telegram turns go to the phone; destructive ones only offer Deny. */
  function onConfirm(e: ConfirmRequestEvent): void {
    const turn = s.orchestrator.currentTurn();
    const chat = turn ? turns.get(turn.turnId) : undefined;
    if (chat === undefined) return;
    const buttons = e.destructive
      ? [{ text: 'Deny', callback_data: `cf:${e.requestId}:deny` }]
      : [
          { text: e.actionLabel || 'Approve', callback_data: `cf:${e.requestId}:approve` },
          { text: 'Deny', callback_data: `cf:${e.requestId}:deny` },
        ];
    const note = e.destructive ? '\n\nThis one can only be approved at your PC.' : '';
    void send(chat, `${e.title}\n\n${e.details.slice(0, 1500)}${note}`, {
      reply_markup: { inline_keyboard: [buttons] },
    }).catch((err: unknown) =>
      log.warn({ err: redact(errorMessage(err)) }, 'telegram confirm failed'),
    );
  }

  async function onTurnEnd(t: TurnEnd): Promise<void> {
    const chat = turns.get(t.turnId);
    if (chat !== undefined) {
      turns.delete(t.turnId);
      const reply = t.replyText.replace(/<\/?spoken>/g, '').trim();
      const text =
        t.outcome === 'error'
          ? 'Something went wrong on the PC, sir. Details are in the app.'
          : reply || '(done)';
      await send(chat, text).catch((err: unknown) =>
        log.warn({ err: redact(errorMessage(err)) }, 'telegram reply failed'),
      );
      return;
    }
    // Briefings and scheduled tasks can be forwarded to the phone.
    const paired = chatId();
    if (
      paired !== null &&
      abort &&
      s.settings.get('telegram.forwardAutomations') &&
      (t.purpose === 'briefing' || t.purpose === 'task') &&
      t.outcome === 'end_turn'
    ) {
      const reply = t.replyText.replace(/<\/?spoken>/g, '').trim();
      if (reply && !/^NOTHING\.?$/i.test(reply)) await send(paired, reply).catch(() => undefined);
    }
  }

  s.confirmShowListeners.add(onConfirm);
  s.orchestrator.onTurnEnd(onTurnEnd);

  async function poll(signal: AbortSignal): Promise<void> {
    let backoff = 2000;
    while (!signal.aborted) {
      try {
        const updates = await api<Update[]>(
          'getUpdates',
          {
            offset,
            timeout: deps.pollTimeoutSec ?? 25,
            allowed_updates: ['message', 'callback_query'],
          },
          AbortSignal.any([signal, AbortSignal.timeout(((deps.pollTimeoutSec ?? 25) + 10) * 1000)]),
        );
        backoff = 2000;
        if (lastError) {
          lastError = null;
          changed();
        }
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message) await onMessage(u.message);
          else if (u.callback_query) await onCallback(u.callback_query);
        }
      } catch (err) {
        if (signal.aborted) return;
        lastError = redact(errorMessage(err));
        changed();
        log.warn({ err: lastError }, 'telegram poll failed');
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  return {
    async start(): Promise<void> {
      if (abort || !s.settings.get('telegram.enabled') || !token()) return;
      abort = new AbortController();
      try {
        const me = await api<{ username: string }>('getMe', {});
        botName = me.username;
        lastError = null;
      } catch (err) {
        lastError = redact(errorMessage(err));
        abort = null;
        changed();
        return;
      }
      if (chatId() === null) pairingCode = String(randomInt(100000, 999999));
      changed();
      void poll(abort.signal);
    },
    stop(): void {
      abort?.abort();
      abort = null;
      changed();
    },
    /** Forget the paired chat and issue a new code. */
    unpair(): void {
      s.settings.set('telegram.chatId', '');
      pairingCode = abort ? String(randomInt(100000, 999999)) : null;
      s.audit.append('user', 'telegram.unpaired', {});
      changed();
    },
    status(): TelegramStatus {
      return {
        running: abort !== null,
        paired: chatId() !== null,
        botName,
        pairingCode,
        error: lastError,
      };
    },
    onStatus(l: () => void): () => void {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
  };
}

export type TelegramChannel = ReturnType<typeof createTelegramChannel>;
