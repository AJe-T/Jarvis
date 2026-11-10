import { z } from 'zod';
import { logger } from '../../logging/logger';
import { findSensitive } from '../../security/redact';
import { runPowerShell } from '../powershell';
import { defineTool, ok, type Tool } from '../types';
import type { OsAdapter } from './os';

/**
 * Clipboard history (idea from Raycast; code is ours): the last text copies, so Sir can get back
 * something he copied earlier. Off until he turns it on (`clipboard.history`).
 *
 * What it never keeps (Security.md §16.17):
 * - anything on disk: the list lives in memory and is gone when Jarvis closes or the setting goes off;
 * - copies a password manager marked "don't keep" (the same Windows marks Jarvis's Passwords sets);
 * - copies Jarvis made himself (passwords, generated passwords, dictation pasting);
 * - text that looks like a secret, a card or an ID number.
 */

const MAX_ITEMS = 50;
const MAX_CHARS = 20_000;
const POLL_MS = 1500;
const IGNORE_MS = 5000;
const PREVIEW_CHARS = 500;

/** '1' when the clipboard carries a "keep this out of clipboard history" mark. Reads no content. */
const PS_IS_PRIVATE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$d = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($d -and ($d.GetDataPresent('ExcludeClipboardContentFromMonitorProcessing') -or $d.GetDataPresent('CanIncludeInClipboardHistory'))) { '1' } else { '0' }`;

let warned = false;

/** Asks Windows whether the current clipboard is marked private. Any failure counts as private. */
export async function clipboardIsPrivate(): Promise<boolean> {
  const r = await runPowerShell(PS_IS_PRIVATE, { timeoutMs: 10_000 }).catch(() => null);
  if (r?.exitCode !== 0 && !warned) {
    warned = true;
    // Said once: if this always fails, the history stays empty and the log says why.
    logger.warn({ err: r?.stderr.slice(0, 200) }, 'clipboard privacy check failed; copy not kept');
  }
  return r?.exitCode !== 0 || r.stdout.trim() !== '0';
}

export interface ClipItem {
  id: number;
  text: string;
  /** Epoch ms when Jarvis first saw it. */
  at: number;
}

export interface ClipboardHistoryDeps {
  read(): Promise<string>;
  isPrivate(): Promise<boolean>;
  enabled(): boolean;
  now?: () => number;
}

export type ClipboardHistory = ReturnType<typeof createClipboardHistory>;

export function createClipboardHistory(d: ClipboardHistoryDeps) {
  const now = d.now ?? Date.now;
  let items: ClipItem[] = [];
  let last: string | null = null;
  let nextId = 1;
  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  /** Text Jarvis put on the clipboard himself → when to stop expecting it. */
  const own = new Map<string, number>();

  function isOwn(text: string): boolean {
    const until = own.get(text);
    for (const [t, exp] of own) if (exp < now()) own.delete(t);
    if (until === undefined || until < now()) return false;
    own.delete(text);
    return true;
  }

  /** Looks at the clipboard once and keeps the text if it is new and safe to keep. */
  async function poll(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (!d.enabled()) {
        items = [];
        last = null;
        return;
      }
      const text = await d.read().catch(() => '');
      // The first look only notes what is there: it was copied before the history was on.
      const first = last === null;
      if (text === last) return;
      last = text;
      if (first || !text.trim() || text.length > MAX_CHARS) return;
      if (isOwn(text) || findSensitive(text).length > 0) return;
      if (await d.isPrivate().catch(() => true)) return;
      items = [{ id: nextId++, text, at: now() }, ...items.filter((i) => i.text !== text)].slice(
        0,
        MAX_ITEMS,
      );
    } finally {
      busy = false;
    }
  }

  return {
    poll,
    start(): void {
      timer ??= setInterval(() => void poll(), POLL_MS);
      timer.unref?.();
    },
    stop(): void {
      clearInterval(timer);
      timer = undefined;
      items = [];
      last = null;
    },
    /** Newest first; with a query, only the copies where every word appears. */
    list(query = ''): ClipItem[] {
      if (!d.enabled()) return [];
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      return items.filter((i) => words.every((w) => i.text.toLowerCase().includes(w)));
    },
    get: (id: number): ClipItem | undefined => items.find((i) => i.id === id),
    /** Jarvis is about to put this on the clipboard himself: it is not Sir's copy, don't keep it. */
    ignore(text: string): void {
      own.set(text, now() + IGNORE_MS);
    },
    clear(): void {
      items = [];
    },
  };
}

/** The OS adapter, telling the history about every clipboard write Jarvis makes himself. */
export function reportingOwnCopies(os: OsAdapter, ignore: (text: string) => void): OsAdapter {
  return {
    ...os,
    clipboardWrite: (text) => {
      ignore(text);
      return os.clipboardWrite(text);
    },
    pasteText: (text) => {
      ignore(text);
      return os.pasteText(text);
    },
  };
}

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export function createClipboardHistoryTool(history: ClipboardHistory, now = Date.now): Tool {
  return defineTool({
    name: 'clipboard_history',
    description:
      'List what sir copied earlier (text only, newest first), optionally only the copies containing some words. Use it for "what did I copy before", "paste the link I copied an hour ago": find the copy here, then write_clipboard puts it back. Requires confirmation because copies can be private. Empty unless sir turned on clipboard history in Settings → Privacy.',
    input: z.object({
      query: z.string().max(100).default(''),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    tier: 'CONFIRM',
    untrustedOutput: true,
    summarize: ({ query }) =>
      query ? `Read clipboard history for "${query}"` : 'Read the clipboard history',
    confirm: () => ({
      title: 'Let Jarvis read your clipboard history?',
      actionLabel: 'Read history',
      details: 'The text of your recent copies will be sent to Claude.',
      detailsKind: 'text',
    }),
    run({ query, limit }) {
      const hits = history.list(query).slice(0, limit);
      if (hits.length === 0)
        return Promise.resolve(
          ok(
            query
              ? `No recent copy contains "${query}".`
              : 'The clipboard history is empty. It only records while the setting "Keep a clipboard history" (Settings → Privacy) is on.',
          ),
        );
      const text = hits
        .map((h) => {
          const cut = h.text.length > PREVIEW_CHARS;
          return `[${ago(now() - h.at)}] ${h.text.slice(0, PREVIEW_CHARS)}${cut ? '…' : ''}`;
        })
        .join('\n---\n');
      return Promise.resolve({
        content: [{ type: 'text' as const, text }],
        untrustedSource: 'clipboard',
      });
    },
  });
}
