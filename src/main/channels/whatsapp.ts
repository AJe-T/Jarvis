import { rmSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import type { WAMessage, WASocket } from 'baileys';
import { z } from 'zod';
import type { TurnEnd } from '../agent/orchestrator';
import { errorMessage } from '../errors';
import { logger } from '../logging/logger';
import { redact } from '../security/redact';
import type { Services } from '../services';
import type { ConfirmRequestEvent } from '../tools/confirmation-broker';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import { chunkMessage } from './telegram';

/**
 * WhatsApp channel (PRD F21) through Baileys (MIT), which links Jarvis as a WhatsApp "linked device"
 * (like WhatsApp Web) — free, no business account. Unofficial: WhatsApp may block numbers that use
 * it, so it is off by default and Settings says so. Sir talks to Jarvis in his own "Message yourself"
 * chat, starting messages with his wake word ("Jarvis, …") so normal notes to self are left alone.
 * Nobody else can command the PC: messages from other chats are never read as instructions.
 */

export interface WhatsAppStatus {
  state: 'off' | 'connecting' | 'qr' | 'open' | 'error';
  qr: string | null;
  me: string | null;
  error: string | null;
}

/** Only a bare yes/no answers a confirmation, so a note to self like "ok, buy milk" never does. */
const YES = /^(yes|approve)[.!]?$/i;
const NO = /^(no|deny)[.!]?$/i;
const CONFIRM_TTL_MS = 2 * 60_000;
const CONVERSATION_GAP_MS = 12 * 3_600_000;

/** "Jarvis, what's the weather" → "what's the weather"; null when the message isn't for Jarvis. */
export function stripWakeWord(text: string, prefix: string): string | null {
  const t = text.trim();
  if (!prefix) return t || null;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s,:!.-]*`, 'i');
  if (!re.test(t)) return null;
  const rest = t.replace(re, '').trim();
  return rest || 'Hello';
}

/** Phone number (any format, with country code) → WhatsApp user id. */
export function toJid(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `${digits}@s.whatsapp.net` : null;
}

const silent = {
  level: 'silent',
  child: () => silent,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createWhatsAppChannel(s: Services) {
  const log = logger.child({ module: 'whatsapp' });
  const authDir = join(s.userData, 'whatsapp-auth');
  let sock: WASocket | null = null;
  let status: WhatsAppStatus = { state: 'off', qr: null, me: null, error: null };
  let stopped = true;
  let backoff = 2000;
  let selfJids: string[] = [];
  /** Ids of messages Jarvis sent, so his own replies in the self-chat are not read as commands. */
  const sentIds = new Set<string>();
  const turns = new Map<string, string>(); // turn id → chat jid
  let conversation: { id: string; at: number } | null = null;
  let pendingConfirm: { requestId: string; jid: string; until: number } | null = null;
  /** Texts Jarvis is sending right now: Baileys may report them before sendMessage returns an id. */
  const sending = new Set<string>();
  const listeners = new Set<() => void>();
  const set = (patch: Partial<WhatsAppStatus>): void => {
    status = { ...status, ...patch };
    listeners.forEach((l) => l());
  };

  async function send(jid: string, text: string): Promise<void> {
    if (!sock) throw new Error('WhatsApp is not connected.');
    for (const part of chunkMessage(text, 3500)) {
      sending.add(part);
      try {
        const m = await sock.sendMessage(jid, { text: part });
        if (m?.key.id) sentIds.add(m.key.id);
      } finally {
        setTimeout(() => sending.delete(part), 10_000);
      }
    }
    if (sentIds.size > 500) sentIds.clear();
  }

  function isSelfChat(
    jid: string | null | undefined,
    areSame: (a?: string, b?: string) => boolean,
  ): boolean {
    return !!jid && selfJids.some((me) => areSame(jid, me));
  }

  async function onMessage(
    m: WAMessage,
    areSame: (a?: string, b?: string) => boolean,
  ): Promise<void> {
    const id = m.key.id ?? '';
    if (!m.key.fromMe || sentIds.has(id)) return;
    const jid = m.key.remoteJid ?? '';
    const alt = (m.key as { remoteJidAlt?: string }).remoteJidAlt;
    if (!isSelfChat(jid, areSame) && !isSelfChat(alt, areSame)) return;
    const raw = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '';
    if (!raw.trim() || sending.has(raw)) return;
    if (pendingConfirm && Date.now() > pendingConfirm.until) pendingConfirm = null;

    // A yes/no answer to a confirmation Jarvis asked about in this chat.
    if (pendingConfirm && (YES.test(raw.trim()) || NO.test(raw.trim()))) {
      const okd = s.broker.respond(
        pendingConfirm.requestId,
        YES.test(raw.trim()) ? 'approve' : 'deny',
        'remote',
      );
      pendingConfirm = null;
      if (!okd) await send(jid, 'That request expired or must be approved at the PC, sir.');
      return;
    }
    const text = stripWakeWord(raw, s.settings.get('whatsapp.prefix'));
    if (text === null) return;
    if (/^\/?stop( everything)?$/i.test(text)) {
      s.killSwitch.trigger('whatsapp');
      return void send(jid, 'Stopped everything, sir.');
    }
    const recent =
      conversation && Date.now() - conversation.at < CONVERSATION_GAP_MS
        ? conversation.id
        : undefined;
    const { conversationId, turnId } = s.orchestrator.send({
      text,
      source: 'text',
      ...(recent ? { conversationId: recent } : {}),
    });
    conversation = { id: conversationId, at: Date.now() };
    turns.set(turnId, jid);
    void sock?.sendPresenceUpdate('composing', jid).catch(() => undefined);
  }

  async function connect(): Promise<void> {
    const baileys = await import('baileys');
    const makeSocket = baileys.makeWASocket;
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    set({ state: 'connecting', error: null });
    const next = makeSocket({
      auth: state,
      logger: silent,
      browser: baileys.Browsers.windows('Jarvis'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock = next;
    next.ev.on('creds.update', () => void saveCreds());
    next.ev.on('connection.update', (u) => {
      if (sock !== next) return;
      if (u.qr)
        void QRCode.toDataURL(u.qr, { margin: 1, width: 260 })
          .then((qr) => set({ state: 'qr', qr }))
          .catch(() => undefined);
      if (u.connection === 'open') {
        backoff = 2000;
        selfJids = [next.user?.id, next.user?.lid].filter((x): x is string => !!x);
        set({
          state: 'open',
          qr: null,
          me: (next.user?.id ?? '').split(/[:@]/)[0] ?? null,
          error: null,
        });
        s.audit.append('user', 'whatsapp.connected', {});
      }
      if (u.connection === 'close') {
        sock = null;
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;
        if (code === baileys.DisconnectReason.loggedOut) {
          rmSync(authDir, { recursive: true, force: true });
          set({
            state: 'error',
            qr: null,
            me: null,
            error: 'WhatsApp logged this PC out. Scan a new QR code.',
          });
          return;
        }
        if (stopped) return set({ state: 'off', qr: null });
        set({ state: 'connecting' });
        setTimeout(() => {
          if (!stopped) void connect().catch(onFatal);
        }, backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    });
    next.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages)
        void onMessage(m, baileys.areJidsSameUser).catch((err: unknown) =>
          log.warn({ err: redact(errorMessage(err)) }, 'whatsapp message failed'),
        );
    });
  }

  function onFatal(err: unknown): void {
    log.warn({ err: redact(errorMessage(err)) }, 'whatsapp failed');
    set({ state: 'error', error: redact(errorMessage(err)) });
  }

  s.orchestrator.onTurnEnd(async (t: TurnEnd) => {
    const jid = turns.get(t.turnId);
    const reply = t.replyText.replace(/<\/?spoken>/g, '').trim();
    if (jid) {
      turns.delete(t.turnId);
      await send(
        jid,
        t.outcome === 'error' ? 'Something went wrong on the PC, sir.' : reply || '(done)',
      ).catch((err: unknown) =>
        log.warn({ err: redact(errorMessage(err)) }, 'whatsapp reply failed'),
      );
      return;
    }
    const self = selfJids[0];
    if (
      self &&
      status.state === 'open' &&
      s.settings.get('whatsapp.forwardAutomations') &&
      (t.purpose === 'briefing' || t.purpose === 'task') &&
      t.outcome === 'end_turn' &&
      reply &&
      !/^NOTHING\.?$/i.test(reply)
    )
      await send(self, reply).catch(() => undefined);
  });

  s.confirmShowListeners.add((e: ConfirmRequestEvent) => {
    const turn = s.orchestrator.currentTurn();
    const jid = turn ? turns.get(turn.turnId) : undefined;
    if (!jid) return;
    if (!e.destructive)
      pendingConfirm = { requestId: e.requestId, jid, until: Date.now() + CONFIRM_TTL_MS };
    void send(
      jid,
      `${e.title}\n\n${e.details.slice(0, 1200)}\n\n${e.destructive ? 'This one can only be approved at your PC.' : 'Reply *yes* to approve or *no* to deny.'}`,
    ).catch(() => undefined);
  });

  return {
    async start(): Promise<void> {
      if (!stopped || !s.settings.get('whatsapp.enabled')) return;
      stopped = false;
      await connect().catch(onFatal);
    },
    stop(): void {
      stopped = true;
      const old = sock;
      sock = null;
      void old?.end(undefined);
      set({ state: 'off', qr: null });
    },
    /** Unlinks this PC from WhatsApp and forgets the session keys. */
    async logout(): Promise<void> {
      stopped = true;
      await sock?.logout().catch(() => undefined);
      sock = null;
      rmSync(authDir, { recursive: true, force: true });
      s.audit.append('user', 'whatsapp.logout', {});
      set({ state: 'off', qr: null, me: null, error: null });
    },
    status: (): WhatsAppStatus => status,
    onStatus(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** For the send_whatsapp tool. */
    async sendTo(jid: string, text: string): Promise<void> {
      await send(jid, text);
    },
    connected: (): boolean => status.state === 'open',
  };
}

export type WhatsAppChannel = ReturnType<typeof createWhatsAppChannel>;

/** Lets Jarvis send a WhatsApp message for Sir — always with his approval. */
export function createWhatsAppTool(wa: WhatsAppChannel): Tool {
  return defineTool({
    name: 'send_whatsapp',
    description:
      "Send a WhatsApp message from sir's own account to a phone number (with country code, e.g. +91 98765 43210). Only when sir asks to message someone. Always asks sir to approve the exact text first.",
    input: z.object({
      phone: z.string().min(8).max(25),
      text: z.string().min(1).max(4000),
    }),
    tier: 'CONFIRM',
    // A sent message can't be unsent: approve it at the PC only (never by voice, phone or chat reply).
    destructive: true,
    externalFacing: true,
    guards: (i) => ({ text: [i.text] }),
    summarize: (i) => `Send a WhatsApp message to ${i.phone}`,
    confirm: (i) => ({
      title: `Send this WhatsApp message to ${i.phone}?`,
      actionLabel: 'Send',
      details: i.text,
      detailsKind: 'text',
    }),
    async run(i) {
      if (!wa.connected())
        return fail('WhatsApp is not connected. Turn it on in Settings → Phone & chat apps.');
      const jid = toJid(i.phone);
      if (!jid) return fail('That does not look like a phone number with a country code.');
      await wa.sendTo(jid, i.text);
      return ok(`Sent to ${i.phone}.`);
    },
  });
}
